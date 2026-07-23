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

  it.effect("rejects a Change whose Repository Preparation has not succeeded", () =>
    Effect.gen(function* () {
      const root = initializedRepository("exit 7");
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

  it.effect.each([
    ["already active", { ok: true, host: "herdr", status: "already_active" }, 0, "already_active"],
    [
      "unavailable",
      { ok: false, code: "host_unavailable", message: "Herdr is stopped." },
      1,
      "host_unavailable",
    ],
    [
      "launch failure",
      { ok: false, code: "launch_failed", message: "Pane is unavailable." },
      1,
      "launch_failed",
    ],
  ] as const)("reports a %s Interactive Session Host result", ([_name, hostResult, status, code]) =>
    Effect.gen(function* () {
      const root = initializedRepository();
      const started = yield* runByInProcessEffect(
        root,
        ["change", "start", "--output", "json"],
        now,
      );
      const change = JSON.parse(started.stdout) as { readonly change: { readonly id: string } };
      const host: InteractiveSessionHost = { launch: async () => hostResult };

      const result = yield* runByInProcessEffect(
        root,
        ["change", "implement", change.change.id, "--output", "json"],
        now,
        { interactiveSessionHost: host },
      );

      expect(result.status).toBe(status);
      expect(JSON.parse(result.stdout)).toMatchObject(
        status === 0 ? { status: "already_active" } : { error: { code } },
      );
    }),
  );

  it.effect("maps a rejected Interactive Session Host launch to launch_failed", () =>
    Effect.gen(function* () {
      const root = initializedRepository();
      const started = yield* runByInProcessEffect(
        root,
        ["change", "start", "--output", "json"],
        now,
      );
      const change = JSON.parse(started.stdout) as { readonly change: { readonly id: string } };
      const host: InteractiveSessionHost = {
        launch: async () => {
          throw new Error("Pane creation rejected");
        },
      };

      const result = yield* runByInProcessEffect(
        root,
        ["change", "implement", change.change.id, "--output", "json"],
        now,
        { interactiveSessionHost: host },
      );

      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: { code: "launch_failed", message: "Pane creation rejected" },
      });
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

  it.effect("keeps a ready Change launchable after a retryable host failure", () =>
    Effect.gen(function* () {
      const root = initializedRepository();
      const started = yield* runByInProcessEffect(
        root,
        ["change", "start", "--output", "json"],
        now,
      );
      const change = JSON.parse(started.stdout) as { readonly change: { readonly id: string } };
      const unavailable: InteractiveSessionHost = {
        launch: async () => ({ ok: false, code: "host_unavailable", message: "Herdr is stopped." }),
      };
      const available: InteractiveSessionHost = {
        launch: async () => ({ ok: true, host: "herdr", status: "started" }),
      };

      const failed = yield* runByInProcessEffect(
        root,
        ["change", "implement", change.change.id, "--output", "json"],
        now,
        { interactiveSessionHost: unavailable },
      );
      const retried = yield* runByInProcessEffect(
        root,
        ["change", "implement", change.change.id, "--output", "json"],
        now,
        { interactiveSessionHost: available },
      );

      expect(failed.status).toBe(1);
      expect(retried.status).toBe(0);
      expect(JSON.parse(retried.stdout)).toMatchObject({ status: "started" });
    }),
  );

  it.effect(
    "passes a valid handoff at the 256 KiB limit unchanged to the Interactive Session Host",
    () =>
      Effect.gen(function* () {
        const root = initializedRepository();
        const started = yield* runByInProcessEffect(
          root,
          ["change", "start", "--output", "json"],
          now,
        );
        const change = JSON.parse(started.stdout) as { readonly change: { readonly id: string } };
        const handoff = "x".repeat(contractMaxHandoffBytes);
        const handoffPath = join(root, "handoff.md");
        writeFileSync(handoffPath, handoff);
        const received: string[] = [];
        const host: InteractiveSessionHost = {
          launch: async (input) => {
            if (input.initialPrompt !== undefined) received.push(input.initialPrompt);
            return { ok: true, host: "herdr", status: "started" };
          },
        };

        const result = yield* runByInProcessEffect(
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
          { interactiveSessionHost: host },
        );

        expect(result.status).toBe(0);
        expect(received).toEqual([handoff]);
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
