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
const contractMaxHandoffBytes = 256 * 1024;
let readyRepositoryTemplate: string;
let unreadyRepositoryTemplate: string;

beforeAll(() => {
  readyRepositoryTemplate = acquireTestWorkspace();
  initializedRepository(undefined, readyRepositoryTemplate);
  unreadyRepositoryTemplate = acquireTestWorkspace();
  initializedRepository("exit 7", unreadyRepositoryTemplate);
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

const invalidHandoffCases = [
  [
    "missing",
    {
      fileName: "missing.md",
      setup: (_path: string): void => undefined,
      code: "handoff_file_not_found",
      message: "Change handoff file was not found.",
      maxBytes: undefined,
      help: "Create the handoff file, then rerun Change Implement.",
    },
  ],
  [
    "non-regular",
    {
      fileName: "handoff-directory",
      setup: (path: string): void => mkdirSync(path),
      code: "handoff_file_unreadable",
      message: "Change handoff must be a readable regular file.",
      maxBytes: undefined,
      help: "Use a readable regular file for --handoff-file.",
    },
  ],
  [
    "oversized",
    {
      fileName: "large.md",
      setup: (path: string): void => writeFileSync(path, "x".repeat(contractMaxHandoffBytes + 1)),
      code: "handoff_file_too_large",
      message: "Change handoff file is larger than 256 KiB.",
      maxBytes: contractMaxHandoffBytes,
      help: "Shorten the handoff file to 256 KiB or less.",
    },
  ],
  [
    "invalid UTF-8",
    {
      fileName: "invalid.bin",
      setup: (path: string): void => writeFileSync(path, Buffer.from([0xff])),
      code: "invalid_handoff_encoding",
      message: "Change handoff file must be valid UTF-8.",
      maxBytes: undefined,
      help: "Rewrite the handoff file as UTF-8, then retry Change Implement.",
    },
  ],
  [
    "empty",
    {
      fileName: "empty.md",
      setup: (path: string): void => writeFileSync(path, ""),
      code: "empty_handoff_file",
      message: "Change handoff file must not be empty.",
      maxBytes: undefined,
      help: "Write a non-empty handoff file, then retry Change Implement.",
    },
  ],
] as const;

describe("by change implement", () => {
  it.effect("launches a ready Change and passes a 256 KiB handoff unchanged", () =>
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
      expect(launch.systemPrompt).toContain(
        'by change decision add <change-id> --choice "<choice>" --rationale "<rationale>"',
      );
      expect(launch.systemPrompt).toContain("Write a Choice as one standalone plain-text line");
      expect(launch.initialPrompt).toBe(
        [`Change identity: ${change.change.id}.`, `Managed Worktree: ${change.worktreePath}.`].join(
          "\n\n",
        ),
      );

      const handoff = "x".repeat(contractMaxHandoffBytes);
      const handoffPath = join(root, "handoff.md");
      writeFileSync(handoffPath, handoff);
      const received: string[] = [];
      const handoffResult = yield* runByInProcessEffect(
        root,
        ["--json", "change", "implement", change.change.id, "--handoff-file", handoffPath],
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
      expect(handoffResult.status).toBe(0);
      expect(received).toHaveLength(1);
      expect(received[0]).toBe(
        [
          `Change identity: ${change.change.id}.`,
          `Managed Worktree: ${change.worktreePath}.`,
          handoff,
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

  it.effect("rejects a Change whose Repository Preparation has not succeeded", () =>
    Effect.gen(function* () {
      const root = yield* unreadyRepository();
      const started = yield* runByInProcessEffect(root, ["--json", "change", "start"], now);
      const failure = JSON.parse(started.stdout) as {
        readonly error: { readonly changeId: string };
      };
      const submit = yield* runByInProcessEffect(
        root,
        ["--json", "change", "submit", failure.error.changeId],
        now,
      );
      expect(submit.status).toBe(1);
      expect(JSON.parse(submit.stdout)).toMatchObject({
        error: {
          code: "change_not_ready",
          changeId: failure.error.changeId,
          recovery: {
            authority: "change_submit",
            action: "prepare_change",
            retryCommand: `by change submit ${failure.error.changeId}`,
          },
        },
      });

      const host: InteractiveSessionHost = {
        launch: async () => {
          throw new Error("Change Implement must not launch an unready Change");
        },
      };

      const result = yield* runByInProcessEffect(
        root,
        ["--json", "change", "implement", failure.error.changeId],
        now,
        { interactiveSessionHost: host },
      );

      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ error: { code: "change_not_ready" } });
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
      const stdinPath = join(root, "stdin-handoff.md");
      writeFileSync(stdinPath, "Handoff from stdin: Héllo\n");
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
          ["--json", "change", "implement", change.change.id, "--handoff-file", "-"],
          now,
          { interactiveSessionHost: host, stdin: { fd: stdin, isTerminal: false } },
        );
        expect(result.status).toBe(0);
        expect(prompt).toContain("Handoff from stdin: Héllo\n");
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
        ["--json", "change", "implement", "change-1", "--handoff-file", "-"],
        now,
      );

      expect(result.status).toBe(2);
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: { code: "stdin_is_terminal" },
      });
    }),
  );

  it.effect.each(invalidHandoffCases)(
    "maps %s handoff input to its structured usage error",
    ([_name, handoffCase]) =>
      Effect.gen(function* () {
        const root = createTestWorkspace();
        let launches = 0;
        const host: InteractiveSessionHost = {
          launch: async () => {
            launches += 1;
            return { ok: true, host: "herdr", status: "started" };
          },
        };
        const handoffPath = join(root, handoffCase.fileName);
        handoffCase.setup(handoffPath);

        const result = yield* runByInProcessEffect(
          root,
          ["--json", "change", "implement", "change-1", "--handoff-file", handoffPath],
          now,
          { interactiveSessionHost: host },
        );

        expect(result.status).toBe(2);
        expect(JSON.parse(result.stdout)).toEqual({
          error: {
            code: handoffCase.code,
            message: handoffCase.message,
            path: handoffPath,
            ...(handoffCase.maxBytes === undefined ? {} : { maxBytes: handoffCase.maxBytes }),
          },
          help: [handoffCase.help],
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
      ["--json", "task", "create", "--title", title, "--description-file", descriptionPath],
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
