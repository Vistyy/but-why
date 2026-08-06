import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterAll, beforeAll, describe } from "vitest";

import type { InteractiveSessionHost } from "../../src/change/interactiveSessionHost.js";
import { publicTaskId, taskSlugForId } from "../../src/task/taskId.js";
import { commitButWhyConfigAndRecordDefault, runByInProcessEffect } from "../support/by-cli.js";
import {
  cloneInitializedTestRepository,
  createInitializedRepo,
} from "../support/initializedRepo.js";
import {
  acquireTestWorkspace,
  createTestWorkspace,
  releaseTestWorkspace,
} from "../support/testWorkspace.js";
import { runTestProcessOrThrow } from "../support/testProcess.js";

const now = "2026-06-30T12:00:00.000Z";
const contractMaxImplementerPromptBytes = 256 * 1024;
let readyRepositoryTemplate: string;
let unreadyRepositoryTemplate: string;

beforeAll(() => {
  readyRepositoryTemplate = acquireTestWorkspace();
  initializedRepository(undefined, readyRepositoryTemplate);
  unreadyRepositoryTemplate = acquireTestWorkspace();
  initializedRepository("printf 'failed' >&2; exit 7", unreadyRepositoryTemplate);
});

afterAll(() => {
  releaseTestWorkspace(readyRepositoryTemplate);
  releaseTestWorkspace(unreadyRepositoryTemplate);
});

const readyRepository = () =>
  Effect.map(cloneInitializedTestRepository(readyRepositoryTemplate), (root) => {
    writeFileSync(
      join(root, ".test-global-config.json"),
      JSON.stringify({
        defaultAgentProfile: { scope: "global", name: "implementation" },
        agentProfiles: {
          implementation: {
            agentRuntime: "pi",
            runtimeConfig: { model: "openai-codex/gpt-5.6-luna", thinking: "high" },
          },
        },
      }),
    );
    return root;
  });
const unreadyRepository = () => cloneInitializedTestRepository(unreadyRepositoryTemplate);

const invalidImplementerPromptCases = [
  [
    "missing",
    {
      fileName: "missing.md",
      setup: (_path: string): void => undefined,
      code: "implementer_prompt_file_not_found",
      message: "Implementer Prompt file was not found.",
      maxBytes: undefined,
      help: "Create the Implementer Prompt file, then rerun Change Implement.",
    },
  ],
  [
    "non-regular",
    {
      fileName: "implementer-prompt-directory",
      setup: (path: string): void => mkdirSync(path),
      code: "implementer_prompt_file_unreadable",
      message: "Implementer Prompt must be a readable regular file.",
      maxBytes: undefined,
      help: "Use a readable regular file for --implementer-prompt-file.",
    },
  ],
  [
    "oversized",
    {
      fileName: "large.md",
      setup: (path: string): void =>
        writeFileSync(path, "x".repeat(contractMaxImplementerPromptBytes + 1)),
      code: "implementer_prompt_file_too_large",
      message: "Implementer Prompt file is larger than 256 KiB.",
      maxBytes: contractMaxImplementerPromptBytes,
      help: "Shorten the Implementer Prompt file to 256 KiB or less.",
    },
  ],
  [
    "invalid UTF-8",
    {
      fileName: "invalid.bin",
      setup: (path: string): void => writeFileSync(path, Buffer.from([0xff])),
      code: "invalid_implementer_prompt_encoding",
      message: "Implementer Prompt file must be valid UTF-8.",
      maxBytes: undefined,
      help: "Rewrite the Implementer Prompt file as UTF-8, then retry Change Implement.",
    },
  ],
  [
    "empty",
    {
      fileName: "empty.md",
      setup: (path: string): void => writeFileSync(path, ""),
      code: "empty_implementer_prompt_file",
      message: "Implementer Prompt file must not be empty.",
      maxBytes: undefined,
      help: "Write a non-empty Implementer Prompt file, then retry Change Implement.",
    },
  ],
] as const;

describe("by change implement", () => {
  it.effect("launches a ready Change and passes a 256 KiB implementer prompt unchanged", () =>
    Effect.gen(function* () {
      const root = yield* readyRepository();
      const started = yield* runByInProcessEffect(root, ["--json", "change", "start"], now);
      const change = JSON.parse(started.stdout) as {
        readonly change: { readonly id: string };
        readonly worktreePath: string;
      };
      writeFileSync(
        join(change.worktreePath, ".but-why", "config.json"),
        JSON.stringify({
          taskPrefix: "BY",
          agentEnvironment: { command: ["nix", "develop", "-c"] },
        }),
      );
      const launches: unknown[] = [];
      const host: InteractiveSessionHost = {
        launch: async (input) => {
          launches.push(input);
          return { ok: true, host: "herdr", status: "started" };
        },
      };

      const result = yield* runByInProcessEffect(
        root,
        ["--json", "change", "implement", change.change.id],
        now,
        { interactiveSessionHost: host },
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        changeId: change.change.id,
        worktreePath: change.worktreePath,
        host: "herdr",
        status: "started",
        agentProfile: "implementation",
        profileScope: "global",
      });
      expect(launches).toHaveLength(1);
      expect(launches[0]).toMatchObject({
        changeId: change.change.id,
        herdrName: `change-${change.change.id.slice(0, 8)}`,
        piSessionName: `Change ${change.change.id}`,
        repositoryPath: root,
        worktreePath: change.worktreePath,
        agentEnvironment: ["nix", "develop", "-c"],
      });
      const launch = launches[0] as {
        readonly initialPrompt: string;
        readonly systemPrompt: string;
      };
      const commandGuidance = readFileSync(
        "docs/public/skills/but-why/references/command-guidance.md",
        "utf8",
      ).trim();
      const implementationReference = readFileSync(
        "docs/public/skills/but-why/references/implement-change.md",
        "utf8",
      ).trim();
      expect(launch.systemPrompt).toContain(commandGuidance);
      expect(launch.systemPrompt).toContain(implementationReference);
      expect(launch.systemPrompt.indexOf(commandGuidance)).toBe(0);
      expect(launch.systemPrompt.indexOf(implementationReference)).toBeGreaterThan(
        launch.systemPrompt.indexOf(commandGuidance),
      );
      expect(launch.systemPrompt).not.toContain(
        "# But Why\n\nBefore setup or workflow guidance, read",
      );
      expect(launch.systemPrompt).not.toContain("docs/public/setup.md");
      expect(launch.systemPrompt).toContain(
        "The Implementer must not return a final progress report.",
      );
      expect(launch.initialPrompt).toBe(
        [`Change identity: ${change.change.id}.`, `Managed Worktree: ${change.worktreePath}.`].join(
          "\n\n",
        ),
      );

      const implementerPrompt = "x".repeat(contractMaxImplementerPromptBytes);
      const implementerPromptPath = join(root, "implementer-prompt.md");
      writeFileSync(implementerPromptPath, implementerPrompt);
      const received: string[] = [];
      const implementerPromptResult = yield* runByInProcessEffect(
        root,
        [
          "--json",
          "change",
          "implement",
          change.change.id,
          "--implementer-prompt-file",
          implementerPromptPath,
        ],
        now,
        {
          interactiveSessionHost: {
            launch: async (input) => {
              if (input.initialPrompt !== undefined) received.push(input.initialPrompt);
              return { ok: true, host: "herdr", status: "started" };
            },
          },
        },
      );
      expect(implementerPromptResult.status).toBe(0);
      expect(received).toHaveLength(1);
      expect(received[0]).toBe(
        [
          `Change identity: ${change.change.id}.`,
          `Managed Worktree: ${change.worktreePath}.`,
          implementerPrompt,
        ].join("\n\n"),
      );
    }),
  );

  it.effect("names a Task-backed session from its Task ID and immutable title", () =>
    Effect.gen(function* () {
      const root = yield* readyRepository();
      const taskId = yield* createTask(
        root,
        "Record cancellation reasons",
        "Implement this Change.\n",
      );
      expect((yield* runByInProcessEffect(root, ["task", "approve", taskId], now)).status).toBe(0);
      const started = yield* runByInProcessEffect(
        root,
        ["--json", "change", "start", "--task", taskId],
        now,
      );
      const change = JSON.parse(started.stdout) as {
        readonly change: { readonly id: string };
        readonly worktreePath: string;
      };
      let launchInput: unknown;
      const result = yield* runByInProcessEffect(
        root,
        ["--json", "change", "implement", change.change.id],
        now,
        {
          interactiveSessionHost: {
            launch: async (input) => {
              launchInput = input;
              return { ok: true, host: "herdr", status: "started" };
            },
          },
        },
      );

      expect(result.status).toBe(0);
      expect(launchInput).toMatchObject({
        changeId: change.change.id,
        herdrName: taskSlugForId(publicTaskId(taskId)),
        piSessionName: `${taskId} Record cancellation reasons`,
      });
    }),
  );

  it.effect("rejects missing profile resources before launching Herdr", () =>
    Effect.gen(function* () {
      const root = yield* readyRepository();
      writeFileSync(
        join(root, ".test-global-config.json"),
        JSON.stringify({
          defaultAgentProfile: { scope: "global", name: "implementation" },
          agentProfiles: {
            implementation: {
              agentRuntime: "pi",
              runtimeConfig: {
                model: "openai-codex/gpt-5.6-luna",
                extensions: ["extensions/missing"],
              },
            },
          },
        }),
      );
      const started = yield* runByInProcessEffect(root, ["--json", "change", "start"], now);
      const change = JSON.parse(started.stdout) as {
        readonly change: { readonly id: string };
        readonly worktreePath: string;
      };
      let launches = 0;
      const result = yield* runByInProcessEffect(
        root,
        ["--json", "change", "implement", change.change.id],
        now,
        {
          interactiveSessionHost: {
            launch: async () => {
              launches += 1;
              return { ok: true, host: "herdr", status: "started" };
            },
          },
        },
      );

      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: {
          code: "agent_profile_invalid",
          message: `Agent Profile "implementation" in global scope has a missing extension resource at resolved path "${join(root, "extensions/missing")}".`,
        },
      });
      expect(launches).toBe(0);
    }),
  );

  it.effect("uses the canonical main checkout from a linked caller checkout", () =>
    Effect.gen(function* () {
      const root = yield* readyRepository();
      const linkedCheckout = join(dirname(root), `${basename(root)}-linked-caller`);
      runTestProcessOrThrow(
        "git",
        ["worktree", "add", "-b", "linked-caller", linkedCheckout, "main"],
        { cwd: root },
      );
      writeFileSync(
        join(linkedCheckout, ".test-global-config.json"),
        JSON.stringify({
          defaultAgentProfile: { scope: "global", name: "implementation" },
          agentProfiles: {
            implementation: {
              agentRuntime: "pi",
              runtimeConfig: { model: "openai-codex/gpt-5.6-luna", thinking: "high" },
            },
          },
        }),
      );

      try {
        const started = yield* runByInProcessEffect(root, ["--json", "change", "start"], now);
        const change = JSON.parse(started.stdout) as {
          readonly change: { readonly id: string };
          readonly worktreePath: string;
        };
        const launches: unknown[] = [];
        const host: InteractiveSessionHost = {
          launch: async (input) => {
            launches.push(input);
            return { ok: true, host: "herdr", status: "started" };
          },
        };

        const fromMain = yield* runByInProcessEffect(
          root,
          ["--json", "change", "implement", change.change.id],
          now,
          { interactiveSessionHost: host },
        );
        const fromLinked = yield* runByInProcessEffect(
          linkedCheckout,
          ["--json", "change", "implement", change.change.id],
          now,
          { interactiveSessionHost: host },
        );

        expect(fromMain.status).toBe(0);
        expect(fromLinked.status).toBe(0);
        expect(launches).toEqual([
          expect.objectContaining({
            changeId: change.change.id,
            repositoryPath: root,
            worktreePath: change.worktreePath,
          }),
          expect.objectContaining({
            changeId: change.change.id,
            repositoryPath: root,
            worktreePath: change.worktreePath,
          }),
        ]);
      } finally {
        runTestProcessOrThrow("git", ["worktree", "remove", "--force", linkedCheckout], {
          cwd: root,
        });
      }
    }),
  );

  it.effect("passes the selected Global Pi Agent Profile to the Interactive Session Host", () =>
    Effect.gen(function* () {
      const root = yield* readyRepository();
      const started = yield* runByInProcessEffect(root, ["--json", "change", "start"], now);
      const change = JSON.parse(started.stdout) as { readonly change: { readonly id: string } };
      const globalConfigPath = join(root, "global-config.json");
      writeFileSync(
        globalConfigPath,
        JSON.stringify({
          interactiveSession: { agentProfile: { scope: "global", name: "implementation" } },
          agentProfiles: {
            implementation: {
              agentRuntime: "pi",
              runtimeConfig: { model: "openai-codex/gpt-5.6-luna", thinking: "high" },
            },
          },
        }),
      );
      const launches: unknown[] = [];

      const result = yield* runByInProcessEffect(
        root,
        ["--json", "change", "implement", change.change.id],
        now,
        {
          globalConfigPath,
          interactiveSessionHost: {
            launch: async (input) => {
              launches.push(input);
              return { ok: true, host: "herdr", status: "started" };
            },
          },
        },
      );

      expect(result.status).toBe(0);
      expect(launches).toEqual([
        expect.objectContaining({
          agentProfile: expect.objectContaining({
            agentProfile: "implementation",
            scope: "global",
          }),
        }),
      ]);
    }),
  );

  it.effect.each([
    ["no selection", {}, "not configured"],
    [
      "missing",
      {
        interactiveSession: { agentProfile: { scope: "global", name: "implementation" } },
      },
      "was not found",
    ],
    [
      "non-Pi",
      {
        interactiveSession: { agentProfile: { scope: "global", name: "implementation" } },
        agentProfiles: {
          implementation: { agentRuntime: "codex" },
        },
      },
      "Global Config is invalid",
    ],
  ] as const)(
    "rejects a %s Interactive Session Agent Profile without launching or changing the Change",
    ([_name, globalConfig, message]) =>
      Effect.gen(function* () {
        const root = yield* readyRepository();
        const started = yield* runByInProcessEffect(root, ["--json", "change", "start"], now);
        const change = JSON.parse(started.stdout) as { readonly change: { readonly id: string } };
        const globalConfigPath = join(root, "global-config.json");
        writeFileSync(globalConfigPath, JSON.stringify(globalConfig));
        const before = yield* runByInProcessEffect(
          root,
          ["--json", "change", "show", change.change.id],
          now,
        );
        let launches = 0;

        const result = yield* runByInProcessEffect(
          root,
          ["--json", "change", "implement", change.change.id],
          now,
          {
            globalConfigPath,
            interactiveSessionHost: {
              launch: async () => {
                launches += 1;
                return { ok: true, host: "herdr", status: "started" };
              },
            },
          },
        );
        const after = yield* runByInProcessEffect(
          root,
          ["--json", "change", "show", change.change.id],
          now,
        );

        expect(result.status).toBe(1);
        expect(JSON.parse(result.stdout)).toMatchObject({
          error: {
            code: "agent_profile_invalid",
            message: expect.stringContaining(message),
          },
        });
        expect(launches).toBe(0);
        expect(after.stdout).toBe(before.stdout);
      }),
  );

  it.effect("rejects invalid Managed Worktree Repo Config before launching", () =>
    Effect.gen(function* () {
      const root = yield* readyRepository();
      const started = yield* runByInProcessEffect(root, ["--json", "change", "start"], now);
      const change = JSON.parse(started.stdout) as {
        readonly change: { readonly id: string };
        readonly worktreePath: string;
      };
      writeFileSync(
        join(change.worktreePath, ".but-why", "config.json"),
        JSON.stringify({ taskPrefix: "BY", agentEnvironment: { command: [] } }),
      );
      let launches = 0;

      const result = yield* runByInProcessEffect(
        root,
        ["--json", "change", "implement", change.change.id],
        now,
        {
          interactiveSessionHost: {
            launch: async () => {
              launches += 1;
              return { ok: true, host: "herdr", status: "started" };
            },
          },
        },
      );

      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: { code: "agent_environment_invalid" },
      });
      expect(launches).toBe(0);
    }),
  );

  it.effect(
    "keeps implementation and the implementer prompt available after failed preparation",
    () =>
      Effect.gen(function* () {
        const root = yield* unreadyRepository();
        writeFileSync(
          join(root, ".test-global-config.json"),
          JSON.stringify({
            defaultAgentProfile: { scope: "global", name: "implementation" },
            agentProfiles: {
              implementation: {
                agentRuntime: "pi",
                runtimeConfig: { model: "openai-codex/gpt-5.6-luna", thinking: "high" },
              },
            },
          }),
        );
        const started = yield* runByInProcessEffect(root, ["--json", "change", "start"], now);
        expect(started.status).toBe(0);
        const output = JSON.parse(started.stdout) as {
          readonly change: { readonly id: string };
          readonly worktreePath: string;
          readonly prepareFailure: {
            readonly command: string;
            readonly exitCode: number;
            readonly stderr: string;
          };
        };
        expect(output.prepareFailure).toMatchObject({ exitCode: 7 });

        let launchedPrompt: string | undefined;
        const host: InteractiveSessionHost = {
          launch: async (input) => {
            launchedPrompt = input.initialPrompt;
            return { ok: true, host: "herdr", status: "started" };
          },
        };

        const result = yield* runByInProcessEffect(
          root,
          ["--json", "change", "implement", output.change.id],
          now,
          { interactiveSessionHost: host },
        );

        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          changeId: output.change.id,
          worktreePath: output.worktreePath,
          host: "herdr",
          status: "started",
        });
        expect(launchedPrompt).toContain(`Change identity: ${output.change.id}.`);
        expect(launchedPrompt).toContain("Current Repository Preparation failure");
        expect(launchedPrompt).toContain("exit code: 7");
        expect(launchedPrompt).toContain("stderr (bounded): failed");
      }),
  );

  it.effect(
    "keeps Submission available after failed preparation without altering the failure",
    () =>
      Effect.gen(function* () {
        const root = yield* unreadyRepository();
        const started = yield* runByInProcessEffect(root, ["--json", "change", "start"], now);
        expect(started.status).toBe(0);
        const output = JSON.parse(started.stdout) as {
          readonly change: { readonly id: string };
          readonly worktreePath: string;
        };

        const submit = yield* runByInProcessEffect(
          root,
          ["--json", "change", "submit", output.change.id],
          now,
        );

        expect(submit.status).toBe(0);
        expect(JSON.parse(submit.stdout)).toMatchObject({
          changeId: output.change.id,
          status: "nothing_to_submit",
        });
        const shown = yield* runByInProcessEffect(
          root,
          ["--json", "change", "show", output.change.id],
          now,
        );
        expect(JSON.parse(shown.stdout)).toMatchObject({
          change: {
            id: output.change.id,
            state: "open",
            worktreePath: output.worktreePath,
            prepareFailure: { exitCode: 7 },
          },
        });
      }),
  );

  it.effect("maps host outcomes and remains launchable after retryable failures", () =>
    Effect.gen(function* () {
      const root = yield* readyRepository();
      const started = yield* runByInProcessEffect(root, ["--json", "change", "start"], now);
      const change = JSON.parse(started.stdout) as {
        readonly change: { readonly id: string };
        readonly worktreePath: string;
      };
      writeFileSync(join(change.worktreePath, "dirty.txt"), "uncommitted\n");
      const submit = yield* runByInProcessEffect(
        root,
        ["--json", "change", "submit", change.change.id],
        now,
      );
      expect(submit.status).toBe(1);
      expect(JSON.parse(submit.stdout)).toMatchObject({
        error: {
          code: "dirty_work",
          changeId: change.change.id,
          recovery: {
            authority: "change_submit",
            action: "resolve_dirty_work",
            retryCommand: `by change submit ${change.change.id}`,
          },
        },
      });

      const cases: readonly {
        readonly host: InteractiveSessionHost;
        readonly status: 0 | 1;
        readonly expected: Record<string, unknown>;
      }[] = [
        {
          host: {
            launch: async () => ({
              ok: false,
              code: "host_unavailable",
              message: "Herdr is stopped.",
            }),
          },
          status: 1,
          expected: { error: { code: "host_unavailable" } },
        },
        {
          host: {
            launch: async () => ({
              ok: false,
              code: "launch_failed",
              message: "Pane is unavailable.",
            }),
          },
          status: 1,
          expected: { error: { code: "launch_failed" } },
        },
        {
          host: {
            launch: async () => {
              throw new Error("Pane creation rejected");
            },
          },
          status: 1,
          expected: { error: { code: "launch_failed", message: "Pane creation rejected" } },
        },
        {
          host: { launch: async () => ({ ok: true, host: "herdr", status: "already_active" }) },
          status: 0,
          expected: { status: "already_active" },
        },
        {
          host: { launch: async () => ({ ok: true, host: "herdr", status: "started" }) },
          status: 0,
          expected: { status: "started" },
        },
      ];

      for (const testCase of cases) {
        const result = yield* runByInProcessEffect(
          root,
          ["--json", "change", "implement", change.change.id],
          now,
          { interactiveSessionHost: testCase.host },
        );
        expect(result.status).toBe(testCase.status);
        expect(JSON.parse(result.stdout)).toMatchObject(testCase.expected);
      }
    }),
  );

  it.effect("passes piped UTF-8 standard input to the Interactive Session Host", () =>
    Effect.gen(function* () {
      const root = yield* readyRepository();
      const started = yield* runByInProcessEffect(root, ["--json", "change", "start"], now);
      const change = JSON.parse(started.stdout) as { readonly change: { readonly id: string } };
      const stdinPath = join(root, "stdin-implementer-prompt.md");
      writeFileSync(stdinPath, "Implementer prompt from stdin: Héllo\n");
      const stdin = openSync(stdinPath, "r");
      let prompt: string | undefined;
      const host: InteractiveSessionHost = {
        launch: async (input) => {
          prompt = input.initialPrompt;
          return { ok: true, host: "herdr", status: "started" };
        },
      };

      try {
        const result = yield* runByInProcessEffect(
          root,
          ["--json", "change", "implement", change.change.id, "--implementer-prompt-file", "-"],
          now,
          { interactiveSessionHost: host, stdin: { fd: stdin, isTerminal: false } },
        );
        expect(result.status).toBe(0);
        expect(prompt).toContain("Implementer prompt from stdin: Héllo\n");
      } finally {
        closeSync(stdin);
      }
    }),
  );

  it.effect("rejects standard input as an interactive terminal", () =>
    Effect.gen(function* () {
      const root = createTestWorkspace();

      const result = yield* runByInProcessEffect(
        root,
        ["--json", "change", "implement", "change-1", "--implementer-prompt-file", "-"],
        now,
      );

      expect(result.status).toBe(2);
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: { code: "stdin_is_terminal" },
      });
    }),
  );

  it.effect.each(invalidImplementerPromptCases)(
    "maps %s implementer prompt input to its structured usage error",
    ([_name, implementerPromptCase]) =>
      Effect.gen(function* () {
        const root = createTestWorkspace();
        let launches = 0;
        const host: InteractiveSessionHost = {
          launch: async () => {
            launches += 1;
            return { ok: true, host: "herdr", status: "started" };
          },
        };
        const implementerPromptPath = join(root, implementerPromptCase.fileName);
        implementerPromptCase.setup(implementerPromptPath);

        const result = yield* runByInProcessEffect(
          root,
          [
            "--json",
            "change",
            "implement",
            "change-1",
            "--implementer-prompt-file",
            implementerPromptPath,
          ],
          now,
          { interactiveSessionHost: host },
        );

        expect(result.status).toBe(2);
        expect(JSON.parse(result.stdout)).toEqual({
          error: {
            code: implementerPromptCase.code,
            message: implementerPromptCase.message,
            path: implementerPromptPath,
            ...(implementerPromptCase.maxBytes === undefined
              ? {}
              : { maxBytes: implementerPromptCase.maxBytes }),
          },
          help: [implementerPromptCase.help],
        });
        expect(launches).toBe(0);
      }),
  );
});

const createTask = (root: string, title: string, description: string) =>
  Effect.gen(function* () {
    const descriptionPath = join(root, `.task-${title.toLowerCase().replaceAll(" ", "-")}.md`);
    writeFileSync(descriptionPath, description);
    const created = yield* runByInProcessEffect(
      root,
      ["--json", "task", "create", "--title", title, "--file", descriptionPath],
      now,
    );
    expect(created.status).toBe(0);
    return (JSON.parse(created.stdout) as { readonly task: { readonly id: string } }).task.id;
  });

const initializedRepository = (prepare?: string, workspace?: string): string => {
  const root = createInitializedRepo(workspace);
  writeFileSync(
    join(root, ".but-why", "config.json"),
    `${JSON.stringify(
      {
        taskPrefix: "BY",
        validation: { checks: [{ id: "quality", command: "true" }] },
        ...(prepare === undefined ? {} : { prepare: { command: prepare } }),
      },
      null,
      2,
    )}\n`,
  );
  commitButWhyConfigAndRecordDefault(root);
  return root;
};
