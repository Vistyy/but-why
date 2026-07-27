import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { builtByExecutable, runBuiltByWithInput } from "../support/by-cli.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

describe("by change implement stdin process boundary", () => {
  it("preserves handoff input errors for piped stdin", () => {
    const root = createTestWorkspace();

    const empty = runBuiltByWithInput(
      root,
      "",
      {},
      "change",
      "implement",
      "change-1",
      "--handoff-file",
      "-",
      "--output",
      "json",
    );
    expect(empty.status).toBe(2);
    expect(JSON.parse(empty.stdout)).toMatchObject({ error: { code: "empty_handoff_file" } });

    const invalid = runBuiltByWithInput(
      root,
      Buffer.from([0xff]),
      {},
      "change",
      "implement",
      "change-1",
      "--handoff-file",
      "-",
      "--output",
      "json",
    );
    expect(invalid.status).toBe(2);
    expect(JSON.parse(invalid.stdout)).toMatchObject({
      error: { code: "invalid_handoff_encoding" },
    });

    const oversized = runBuiltByWithInput(
      root,
      "x".repeat(256 * 1024 + 1),
      {},
      "change",
      "implement",
      "change-1",
      "--handoff-file",
      "-",
      "--output",
      "json",
    );
    expect(oversized.status).toBe(2);
    expect(JSON.parse(oversized.stdout)).toMatchObject({
      error: { code: "handoff_file_too_large" },
    });

    const terminal = spawnSync(
      "script",
      [
        "-qec",
        `${process.execPath} ${builtByExecutable()} change implement change-1 --handoff-file - --output json`,
        "/dev/null",
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      },
    );
    expect(terminal.status).toBe(2);
    expect(JSON.parse(terminal.stdout.trim())).toMatchObject({
      error: { code: "stdin_is_terminal" },
    });
  });
});
