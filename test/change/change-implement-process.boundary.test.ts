import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runTestProcess } from "../support/testProcess.js";
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
        defaultAgentProfile: { scope: "global", name: "test" },
        agentProfiles: { test: { agentRuntime: "pi", runtimeConfig: { model: "test/model" } } },
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
  if [ -n "$BY_FAKE_CAPTURE" ] && [ -f "$BY_FAKE_CAPTURE.started" ]; then
    printf '{"result":{"type":"agent_list","agents":[{"name":"%s","cwd":"%s","pane_id":"pane","agent_status":"working"}]}}\\n' "$BY_FAKE_SESSION" "$BY_FAKE_WORKTREE"
  else
    printf '{"result":{"type":"agent_list","agents":[]}}\\n'
  fi
  exit 0
fi
if [ "$1" = "worktree" ] && [ "$2" = "open" ]; then
  printf '{"result":{"type":"worktree_opened","workspace":{"workspace_id":"workspace"},"root_pane":{"pane_id":"pane"},"already_open":false}}\\n'
  exit 0
fi
if [ "$1" = "pane" ] && [ "$2" = "run" ]; then
  printf '%s\\n' "$4" > "$BY_FAKE_CAPTURE"
  : > "$BY_FAKE_CAPTURE.started"
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
      // biome-ignore lint/complexity/useLiteralKeys: NodeJS.ProcessEnv has an index signature.
      PATH: `${tools}:${process.env["PATH"] ?? ""}`,
    };

    const started = runBuiltByWithEnv(root, baseEnv, "--output", "json", "change", "start");
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
      BY_FAKE_SESSION: `but-why-${change.change.id}`,
    };

    const piped = runBuiltByWithInput(
      root,
      "Handoff from piped stdin\n",
      env,
      "--output",
      "json",
      "change",
      "implement",
      change.change.id,
      "--handoff-file",
      "-",
    );
    expect(piped.status, `${piped.stdout}${piped.stderr}`).toBe(0);
    expect(readFileSync(capture, "utf8")).toContain("Handoff from piped stdin");
  }, 30_000);

  it("preserves handoff input errors for piped stdin", () => {
    const root = createTestWorkspace();

    const invalid = runBuiltByWithInput(
      root,
      Buffer.from([0xff]),
      {},
      "--output",
      "json",
      "change",
      "implement",
      "change-1",
      "--handoff-file",
      "-",
    );
    expect(invalid.status).toBe(2);
    expect(JSON.parse(invalid.stdout)).toMatchObject({
      error: { code: "invalid_handoff_encoding" },
    });

    const terminal = runTestProcess(
      "script",

      [
        "-qec",
        `${process.execPath} ${builtByExecutable()} --output json change implement change-1 --handoff-file -`,
        "/dev/null",
      ],
      { cwd: root },
    );
    expect(terminal.status).toBe(2);
    expect(JSON.parse(terminal.stdout.trim())).toMatchObject({
      error: { code: "stdin_is_terminal" },
    });
  }, 30_000);
});
