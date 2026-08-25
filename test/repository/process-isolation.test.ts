import { existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { repoRoot } from "../support/by-cli.js";
import { runTestProcess } from "../support/testProcess.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

describe("test subprocess isolation", () => {
  test("provides an isolated process environment and working directory", () => {
    const fixture = createTestWorkspace();
    const result = runTestProcess(
      "sh",
      ["-c", 'printf \'%s\\n\' "$PWD" "$HOME" "$TMPDIR" "$XDG_STATE_HOME"'],
      { cwd: fixture },
    );
    const [cwd, home, temporaryDirectory, stateDirectory] = result.stdout.trim().split("\n");

    expect(result.status).toBe(0);
    expect(cwd).toBe(fixture);
    // biome-ignore lint/complexity/useLiteralKeys: ProcessEnv requires an index-signature lookup.
    expect(home).not.toBe(process.env["HOME"]);
    expect(temporaryDirectory).toMatch(/but-why-process-/u);
    expect(stateDirectory).toMatch(/but-why-process-/u);
  });

  test("cleans isolated state after synchronous timeout and rejects incomplete output", () => {
    const fixture = createTestWorkspace();
    const timedOut = runTestProcess(
      process.execPath,
      ["-e", "process.stdout.write(process.env.HOME); setTimeout(() => {}, 30_000);"],
      { cwd: fixture, timeout: 50 },
    );

    expect(timedOut.status).toBeNull();
    expect(timedOut.error).toMatchObject({ code: "ETIMEDOUT" });
    expect(existsSync(timedOut.stdout)).toBe(false);

    const overflowing = runTestProcess(
      process.execPath,
      ["-e", 'process.stdout.write("x".repeat(2048));'],
      { cwd: fixture, maxBuffer: 1024 },
    );
    expect(overflowing.status).toBeNull();
    expect(overflowing.error).toMatchObject({ code: "ENOBUFS" });
  });

  test("rejects shared checkout paths and HOME overrides", () => {
    const fixture = createTestWorkspace();
    const checkoutAlias = join(fixture, "checkout-alias");
    const homeAlias = join(fixture, "home-alias");
    symlinkSync(repoRoot, checkoutAlias, "dir");
    symlinkSync(repoRoot, homeAlias, "dir");

    expect(() => runTestProcess("pwd", [], { cwd: repoRoot })).toThrow(
      "Test subprocess cwd must be isolated",
    );
    expect(() => runTestProcess("pwd", [], { cwd: checkoutAlias })).toThrow(
      "Test subprocess cwd must be isolated",
    );
    expect(() => runTestProcess("pwd", [], { cwd: fixture, env: { HOME: repoRoot } })).toThrow(
      "provided as isolatedHome",
    );
    expect(() =>
      runTestProcess("pwd", [], { cwd: fixture, env: { HOME: join(homeAlias, "new-home") } }),
    ).toThrow("provided as isolatedHome");
    expect(() =>
      runTestProcess("pwd", [], {
        cwd: fixture,
        isolatedHome: join(homeAlias, "new-home"),
      }),
    ).toThrow("Test subprocess HOME must be isolated");

    const requestedHome = join(fixture, "new-home");
    const homeResult = runTestProcess("sh", ["-c", "printf '%s' \"$HOME\""], {
      cwd: fixture,
      isolatedHome: requestedHome,
    });
    expect(homeResult.stdout).toBe(requestedHome);
  });
});
