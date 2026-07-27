import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  builtByExecutable,
  commitButWhyConfigAndRecordDefault,
  runBuiltByWithEnv,
  runBuiltByWithInput,
} from "../support/by-cli.js";
import { createInitializedRepo } from "../support/initializedRepo.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

describe("by change implement stdin process boundary", () => {
  it("forwards piped stdin through a real process", () => {
    const root = createInitializedRepo();
    commitButWhyConfigAndRecordDefault(root);
    const home = createTestWorkspace();
    const globalConfigDirectory = join(home, ".config/but-why");
    mkdirSync(globalConfigDirectory, { recursive: true });
    writeFileSync(
      join(globalConfigDirectory, "config.json"),
      `${JSON.stringify({
        defaultAgentProfile: "test",
        agentProfiles: { test: { agentRuntime: "pi", agentModel: "test/model" } },
      })}\n`,
    );
    const tools = createTestWorkspace();
    writeFileSync(
      join(tools, "gh"),
      `#!/usr/bin/env sh
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  printf '{"defaultBranchRef":{"name":"main"}}\\n'
  exit 0
fi
exit 1
`,
    );
    writeFileSync(
      join(tools, "herdr"),
      `#!/usr/bin/env sh
if [ "$1" = "agent" ] && [ "$2" = "list" ]; then
  printf '{"result":{"agents":[]}}\\n'
  exit 0
fi
if [ "$1" = "worktree" ] && [ "$2" = "open" ]; then
  printf '{"result":{"workspace":{"workspace_id":"workspace"},"root_pane":{"pane_id":"pane"},"already_open":false}}\\n'
  exit 0
fi
if [ "$1" = "pane" ] && [ "$2" = "run" ]; then
  printf '%s\\n' "$4" > "$BY_FAKE_CAPTURE"
  printf '{"result":{}}\\n'
  exit 0
fi
if [ "$1" = "agent" ] && [ "$2" = "rename" ]; then
  printf '{"result":{"agent":{"name":"%s","cwd":"%s","pane_id":"%s"}}}\\n' "$4" "$BY_FAKE_WORKTREE" "$3"
  exit 0
fi
exit 1
`,
    );
    chmodSync(join(tools, "gh"), 0o755);
    chmodSync(join(tools, "herdr"), 0o755);
    const baseEnv = {
      HOME: home,
      PATH: `${tools}:${process.env["PATH"] ?? ""}`,
    };

    const started = runBuiltByWithEnv(root, baseEnv, "change", "start", "--output", "json");
    expect(started.status).toBe(0);
    const change = JSON.parse(started.stdout) as {
      readonly change: { readonly id: string };
      readonly worktreePath: string;
    };
    const capture = join(root, "herdr-capture.txt");
    const env = {
      ...baseEnv,
      BY_FAKE_CAPTURE: capture,
      BY_FAKE_WORKTREE: change.worktreePath,
    };

    const piped = runBuiltByWithInput(
      root,
      "Handoff from piped stdin\n",
      env,
      "change",
      "implement",
      change.change.id,
      "--handoff-file",
      "-",
      "--output",
      "json",
    );
    expect(piped.status).toBe(0);
    expect(readFileSync(capture, "utf8")).toContain("Handoff from piped stdin");
  }, 30_000);

  it("preserves handoff input errors for piped stdin", () => {
    const root = createTestWorkspace();

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
  }, 30_000);
});
