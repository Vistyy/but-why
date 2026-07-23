import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterAll, beforeAll, describe } from "vitest";

import type { InteractiveSessionHost } from "../../src/change/interactiveSessionHost.js";
import { commitButWhyConfigAndRecordDefault, runByInProcessEffect } from "../support/by-cli.js";
import { createInitializedRepo } from "../support/initializedRepo.js";
import {
  acquireTestWorkspace,
  cloneInitializedTestRepository,
  createTestWorkspace,
  releaseTestWorkspace,
} from "../support/testWorkspace.js";

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

const readyRepository = () => cloneInitializedTestRepository(readyRepositoryTemplate);
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
      const started = yield* runByInProcessEffect(
        root,
        ["change", "start", "--output", "json"],
        now,
      );
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

      const result = yield* runByInProcessEffect(
        root,
        ["change", "implement", change.change.id, "--output", "json"],
        now,
        { interactiveSessionHost: host },
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        changeId: change.change.id,
        worktreePath: change.worktreePath,
        host: "herdr",
        status: "started",
      });
      expect(launches).toEqual([
        {
          changeId: change.change.id,
          repositoryPath: root,
          worktreePath: change.worktreePath,
          initialPrompt: undefined,
        },
      ]);

      const handoff = "x".repeat(contractMaxHandoffBytes);
      const handoffPath = join(root, "handoff.md");
      writeFileSync(handoffPath, handoff);
      const received: string[] = [];
      const handoffResult = yield* runByInProcessEffect(
        root,
        [
          "change",
          "implement",
          change.change.id,
          "--handoff-file",
          handoffPath,
          "--output",
          "json",
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
      expect(handoffResult.status).toBe(0);
      expect(received).toEqual([handoff]);
    }),
  );

  it.effect("rejects a Change whose Repository Preparation has not succeeded", () =>
    Effect.gen(function* () {
      const root = yield* unreadyRepository();
      const started = yield* runByInProcessEffect(
        root,
        ["change", "start", "--output", "json"],
        now,
      );
      const failure = JSON.parse(started.stdout) as {
        readonly error: { readonly changeId: string };
      };
      const host: InteractiveSessionHost = {
        launch: async () => {
          throw new Error("Change Implement must not launch an unready Change");
        },
      };

      const result = yield* runByInProcessEffect(
        root,
        ["change", "implement", failure.error.changeId, "--output", "json"],
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
      const started = yield* runByInProcessEffect(
        root,
        ["change", "start", "--output", "json"],
        now,
      );
      const change = JSON.parse(started.stdout) as { readonly change: { readonly id: string } };
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
          ["change", "implement", change.change.id, "--output", "json"],
          now,
          { interactiveSessionHost: testCase.host },
        );
        expect(result.status).toBe(testCase.status);
        expect(JSON.parse(result.stdout)).toMatchObject(testCase.expected);
      }
    }),
  );

  it.effect("rejects standard input as a handoff source", () =>
    Effect.gen(function* () {
      const root = createTestWorkspace();

      const result = yield* runByInProcessEffect(
        root,
        ["change", "implement", "change-1", "--handoff-file", "-", "--output", "json"],
        now,
      );

      expect(result.status).toBe(2);
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: { code: "unsupported_stdin_handoff_file" },
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
          ["change", "implement", "change-1", "--handoff-file", handoffPath, "--output", "json"],
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

const initializedRepository = (prepare?: string, workspace?: string): string => {
  const root = createInitializedRepo(workspace);
  if (prepare !== undefined) {
    writeFileSync(
      join(root, ".but-why", "config.json"),
      `${JSON.stringify({ taskPrefix: "BY", prepare: { command: prepare } }, null, 2)}\n`,
    );
  }
  commitButWhyConfigAndRecordDefault(root);
  return root;
};
