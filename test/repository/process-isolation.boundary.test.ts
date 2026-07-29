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

  test("rejects the shared checkout as a subprocess working directory", () => {
    expect(() => runTestProcess("pwd", [], { cwd: repoRoot })).toThrow(
      "Test subprocesses must run in an isolated fixture",
    );
  });
});
