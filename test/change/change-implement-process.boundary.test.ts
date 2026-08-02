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
      "Handoff from piped stdin\n",
      env,
      "--json",
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
      "--json",
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
        `${process.execPath} ${builtByExecutable()} --json change implement change-1 --handoff-file -`,
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
    "records decisions and reads publication history through the executable",
    () =>
      Effect.gen(function* () {
        const root = createInitializedRepo();
        const changeId = randomUUID();
        const emptyChangeId = randomUUID();
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
                (${changeId}, ${join(root, ".git")}, 'refs/heads/process', NULL, 'open', NULL, '2026-07-30T10:00:00.000Z', '2026-07-30T10:00:00.000Z', NULL),
                (${emptyChangeId}, ${join(root, ".git")}, 'refs/heads/empty', NULL, 'open', NULL, '2026-07-30T10:00:00.000Z', '2026-07-30T10:00:00.000Z', NULL)
            `,
            );
            yield* repository.operation(
              "create process publication fixture",
              (sql) => sql`
              INSERT INTO candidate_publications (
                change_id, candidate_id, validation_run_id, change_base_sha, head_sha,
                publication_owner, publication_repo, publication_base_branch,
                publication_remote_name, publication_head_branch, pull_request_number,
                pull_request_url, published_at
              ) VALUES (
                ${changeId}, 'candidate-process', 'run-process', 'base-process', 'head-process',
                'acme', 'repo', 'main', 'origin', 'process', 42,
                'https://github.test/pull/42', '2026-07-30T10:01:00.000Z'
              )
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
        const publications = runBuiltByWithEnv(
          root,
          {},
          "--json",
          "change",
          "publications",
          changeId,
        );
        expect(publications.status).toBe(0);
        expect(JSON.parse(publications.stdout)).toMatchObject({
          changeId,
          count: 1,
          publications: [{ headSha: "head-process" }],
        });
        const toon = runBuiltByWithEnv(root, {}, "change", "publications", changeId);
        expect(toon.status).toBe(0);
        expect(toon.stdout).toContain("head-process");
        const emptyJson = runBuiltByWithEnv(
          root,
          {},
          "--json",
          "change",
          "publications",
          emptyChangeId,
        );
        expect(emptyJson.status).toBe(0);
        expect(JSON.parse(emptyJson.stdout)).toMatchObject({ count: 0, publications: [] });
        const emptyToon = runBuiltByWithEnv(root, {}, "change", "publications", emptyChangeId);
        expect(emptyToon.status).toBe(0);
        expect(emptyToon.stdout).toContain("count: 0");
        const missingId = randomUUID();
        const missingJson = runBuiltByWithEnv(
          root,
          {},
          "--json",
          "change",
          "publications",
          missingId,
        );
        expect(missingJson.status).toBe(1);
        expect(JSON.parse(missingJson.stdout)).toMatchObject({
          error: { code: "change_not_found" },
        });
        const missingToon = runBuiltByWithEnv(root, {}, "change", "publications", missingId);
        expect(missingToon.status).toBe(1);
        expect(missingToon.stdout).toContain("change_not_found");
      }),
    30_000,
  );
});
