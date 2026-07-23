import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import type { InteractiveSessionHost } from "../src/change/interactiveSessionHost.js";
import { commitButWhyConfigAndRecordDefault, runByInProcessEffect } from "./support/by-cli.js";
import { createInitializedRepo } from "./support/initializedRepo.js";
import { createTestWorkspace } from "./support/testWorkspace.js";

const now = "2026-06-30T12:00:00.000Z";
const contractMaxHandoffBytes = 256 * 1024;

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
  it.effect("launches a ready Change in its recorded Managed Worktree", () =>
    Effect.gen(function* () {
      const root = initializedRepository();
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

const initializedRepository = (prepare?: string): string => {
  const root = createInitializedRepo();
  if (prepare !== undefined) {
    writeFileSync(
      join(root, ".but-why", "config.json"),
      `${JSON.stringify({ taskPrefix: "BY", prepare: { command: prepare } }, null, 2)}\n`,
    );
  }
  commitButWhyConfigAndRecordDefault(root);
  return root;
};
