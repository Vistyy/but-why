import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";
import {
  commitButWhyConfigAndRecordDefault,
  createGitRepo,
  runBuiltByWithInput,
  runByInProcessEffect,
} from "../support/by-cli.js";
import { createChangeImplementFixture } from "../support/changeImplementFixture.js";
import { startFakeHerdrApiServer } from "../support/fakeHerdrApiServer.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

describe("compiled Candidate executable stdin and Herdr boundary", () => {
  it.effect(
    "forwards piped stdin through the compiled Candidate executable to Herdr",
    () =>
      Effect.gen(function* () {
        const root = createGitRepo();
        const initialized = yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"]);
        expect(initialized.status).toBe(0);
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
  if [ -n "$BY_FAKE_CAPTURE" ] && [ -f "$BY_FAKE_CAPTURE" ]; then
    printf '{"result":{"type":"agent_list","agents":[{"name":"%s","cwd":"%s","pane_id":"pane","agent_status":"done"}]}}\\n' "$BY_FAKE_SESSION" "$BY_FAKE_WORKTREE"
  elif [ -n "$BY_FAKE_CAPTURE" ] && [ -f "$BY_FAKE_CAPTURE.started" ]; then
    printf '{"result":{"type":"agent_list","agents":[{"name":"%s","cwd":"%s","pane_id":"pane","agent_status":"working"}]}}\\n' "$BY_FAKE_SESSION" "$BY_FAKE_WORKTREE"
  else
    printf '{"result":{"type":"agent_list","agents":[]}}\\n'
  fi
  exit 0
fi
if [ "$1" = "workspace" ] && [ "$2" = "list" ]; then
  printf '{"result":{"type":"workspace_list","workspaces":[]}}\\n'
  exit 0
fi
if [ "$1" = "workspace" ] && [ "$2" = "create" ]; then
  printf '{"result":{"type":"workspace_created","workspace":{"workspace_id":"workspace"},"tab":{"tab_id":"tab","workspace_id":"workspace"},"root_pane":{"pane_id":"pane","workspace_id":"workspace","tab_id":"tab","cwd":"%s"}}}\\n' "$BY_FAKE_WORKTREE"
  exit 0
fi
if [ "$1" = "agent" ] && [ "$2" = "start" ]; then
  printf '%s\\n' "$@" > "$BY_FAKE_CAPTURE.args"
  : > "$BY_FAKE_CAPTURE.started"
  printf '{"result":{"type":"agent_started","agent":{"terminal_id":"terminal"}}}\\n'
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

        const fixture = yield* createChangeImplementFixture(root);
        const capture = join(root, "herdr-capture.txt");
        const env = {
          ...baseEnv,
          BY_FAKE_CAPTURE: capture,
          BY_FAKE_WORKTREE: fixture.worktreePath,
          BY_FAKE_SESSION: fixture.id.toLowerCase(),
        };
        writeFileSync(capture, "done\n");

        const socketPath = join(tools, "herdr.sock");
        const server = yield* Effect.promise(() =>
          startFakeHerdrApiServer({
            socketPath,
            capturePath: capture,
            readyPath: join(tools, "herdr-api-ready"),
          }),
        );
        try {
          const piped = runBuiltByWithInput(
            root,
            "Implementer prompt from piped stdin\n",
            { ...env, HERDR_SOCKET_PATH: socketPath },
            "change",
            "implement",
            fixture.id,
            "--implementer-prompt-file",
            "-",
          );
          expect(piped.status, `${piped.stdout}${piped.stderr}`).toBe(0);
          expect(JSON.parse(piped.stdout)).toMatchObject({ host: "herdr", status: "started" });
          expect(readFileSync(capture, "utf8")).toContain("Implementer prompt from piped stdin");
          expect(existsSync(`${capture}.args`)).toBe(false);
          expect(existsSync(`${capture}.started`)).toBe(false);
        } finally {
          yield* Effect.promise(server.stop);
        }
      }),
    30_000,
  );
});
