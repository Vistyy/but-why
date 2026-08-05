import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Effect } from "effect";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { describe } from "vitest";

import { runTestProcess } from "../support/testProcess.js";
import {
  builtByExecutable,
  commitButWhyConfigAndRecordDefault,
  runBuiltByWithEnv,
  runBuiltByWithInput,
} from "../support/by-cli.js";
import { createInitializedRepo } from "../support/initializedRepo.js";
import { createTestWorkspace } from "../support/testWorkspace.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { withTestRepository } from "../support/repository.js";

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
  launch_script=$(printf '%s' "$4" | sed "s/^exec '//; s/'$//")
  cat "$launch_script" > "$BY_FAKE_CAPTURE"
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

    const started = runBuiltByWithEnv(root, baseEnv, "--json", "change", "start");
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
      BY_FAKE_SESSION: `change-${change.change.id.slice(0, 8)}`,
    };

    const piped = runBuiltByWithInput(
      root,
      "Implementer prompt from piped stdin\n",
      env,
      "--json",
      "change",
      "implement",
      change.change.id,
      "--implementer-prompt-file",
      "-",
    );
    expect(piped.status, `${piped.stdout}${piped.stderr}`).toBe(0);
    expect(readFileSync(capture, "utf8")).toContain("Implementer prompt from piped stdin");
  }, 30_000);

  it("preserves implementer prompt input errors for piped stdin", () => {
    const root = createTestWorkspace();

    const invalid = runBuiltByWithInput(
      root,
      Buffer.from([0xff]),
      {},
      "--json",
      "change",
      "implement",
      "change-1",
      "--implementer-prompt-file",
      "-",
    );
    expect(invalid.status).toBe(2);
    expect(JSON.parse(invalid.stdout)).toMatchObject({
      error: { code: "invalid_implementer_prompt_encoding" },
    });

    const terminal = runTestProcess(
      "script",

      [
        "-qec",
        `${process.execPath} ${builtByExecutable()} --json change implement change-1 --implementer-prompt-file -`,
        "/dev/null",
      ],
      { cwd: root },
    );
    expect(terminal.status).toBe(2);
    expect(JSON.parse(terminal.stdout.trim())).toMatchObject({
      error: { code: "stdin_is_terminal" },
    });
  }, 30_000);

  it.effect(
    "records Implementation Decisions through the executable",
    () =>
      Effect.gen(function* () {
        const root = createInitializedRepo();
        const changeId = randomUUID();
        yield* withTestRepository(
          root,
          Effect.gen(function* () {
            const repository = yield* RepositorySql;
            yield* repository.operation(
              "create process Change fixture",
              (sql) => sql`
              INSERT INTO changes (
                id, repository_common_directory, branch_ref, task_id, state,
                close_reason, created_at, updated_at, closed_at
              ) VALUES
                (${changeId}, ${join(root, ".git")}, 'refs/heads/process', NULL, 'open', NULL, '2026-07-30T10:00:00.000Z', '2026-07-30T10:00:00.000Z', NULL)
            `,
            );
          }),
        );
        const added = runBuiltByWithEnv(
          root,
          {},
          "--json",
          "change",
          "decision",
          "add",
          changeId,
          "--choice",
          "Use the process boundary.",
          "--rationale",
          "Keep the process boundary explicit.",
        );
        expect(added.status).toBe(0);
        const listed = runBuiltByWithEnv(
          root,
          {},
          "--json",
          "change",
          "decision",
          "list",
          changeId,
        );
        expect(listed.status).toBe(0);
        expect(JSON.parse(listed.stdout)).toMatchObject({
          changeId,
          count: 1,
          decisions: [{ choice: "Use the process boundary." }],
        });
      }),
    30_000,
  );
});
