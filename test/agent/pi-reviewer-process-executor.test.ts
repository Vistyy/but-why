import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Option } from "effect";

import { createPiReviewerProcessExecutor } from "../../src/agent/adapters/piReviewerProcessExecutor.js";
import { executeHostCommandEffect } from "../../src/command/hostCommand.js";
import { observeUntil } from "../support/observe.js";

const profile = {
  agentProfile: "review",
  scope: "repo" as const,
  profile: {
    agentRuntime: "pi" as const,
    runtimeConfig: {
      model: "openai-codex/gpt-5.5",
      thinking: "high" as const,
      extensions: ["extensions/reviewer"],
      tools: ["read", "grep"],
    },
  },
};

const input = {
  reviewer: "acceptance",
  systemPrompt: "Act as the Acceptance Reviewer.",
  prompt: "Review the Candidate.",
  profile,
  commandCwd: "/validation/workspace",
  resourceRoot: "/candidate/resources",
};

describe("Pi reviewer process executor", () => {
  it.effect("runs direct Pi arguments and decodes invocation-local output and usage", () =>
    Effect.gen(function* () {
      let observed:
        | { readonly command: string; readonly args?: readonly string[]; readonly cwd?: string }
        | undefined;
      const executor = createPiReviewerProcessExecutor((command) => {
        observed = command;
        return Effect.succeed({
          exitCode: 0,
          stderr: "",
          stdout: `${JSON.stringify({ type: "session", id: "session-1", cwd: command.cwd })}\n${messageEvent(
            '<reviewer-output>{"findings":[]}</reviewer-output>',
            { input: 5, output: 3, cacheRead: 7, cacheWrite: 2, totalTokens: 17 },
          )}\n`,
        });
      });

      const result = yield* executor.execute({
        ...input,
        agentEnvironment: ["nix", "develop", "-c"],
      });

      expect(observed).toEqual({
        command: "nix",
        args: [
          "develop",
          "-c",
          "pi",
          "-p",
          "--mode",
          "json",
          "--model",
          "openai-codex/gpt-5.5",
          "--thinking",
          "high",
          "--no-prompt-templates",
          "--no-themes",
          "--no-extensions",
          "--extension",
          "/candidate/resources/extensions/reviewer",
          "--tools",
          "read,grep",
          "--no-session",
          "--append-system-prompt",
          "Act as the Acceptance Reviewer.",
          "--name",
          "acceptance Review",
          "Review the Candidate.",
        ],
        cwd: "/validation/workspace",
      });
      expect(result).toMatchObject({
        stdout: '<reviewer-output>{"findings":[]}</reviewer-output>',
        invocationUsage: {
          inputTokens: 5,
          cachedInputTokens: 7,
          cacheWriteTokens: 2,
          outputTokens: 3,
          totalTokens: 17,
        },
      });
    }),
  );

  it.effect("keeps unexpected command executor defects out of the expected failure channel", () =>
    Effect.gen(function* () {
      const defect = new Error("unexpected command executor defect");
      const exit = yield* Effect.exit(
        createPiReviewerProcessExecutor(() => Effect.die(defect)).execute(input),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) return;
      expect(Cause.failureOption(exit.cause)).toEqual(Option.none());
      expect(Cause.dieOption(exit.cause)).toEqual(Option.some(defect));
    }),
  );

  it.effect("retains a new Reviewer Session transcript", () =>
    Effect.gen(function* () {
      const root = mkdtempSync(join(tmpdir(), "but-why-pi-reviewer-transcript-"));
      const sessions = join(root, "sessions");
      mkdirSync(sessions);
      const sessionId = "123e4567-e89b-42d3-a456-426614174009";
      const sessionFile = join(sessions, "opaque.jsonl");
      writeFileSync(
        join(sessions, `review_${sessionId}.jsonl`),
        `${JSON.stringify({ type: "session", id: "another-session", cwd: input.commandCwd })}\n`,
      );
      const executor = createPiReviewerProcessExecutor(() => {
        writeFileSync(
          sessionFile,
          `${JSON.stringify({ type: "session", id: sessionId, cwd: input.commandCwd })}\n`,
        );
        return Effect.succeed({
          exitCode: 0,
          stderr: "",
          stdout: `${JSON.stringify({ type: "session", id: sessionId })}\n${messageEvent(
            '<reviewer-output>{"findings":[]}</reviewer-output>',
            { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
          )}\n`,
        });
      });

      try {
        const result = yield* executor.execute({ ...input, sessionStorageRoot: sessions });
        expect(result).toMatchObject({
          sessionReference: sessionId,
          sessionFilePath: sessionFile,
        });
        expect(readFileSync(sessionFile, "utf8")).toContain(sessionId);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }),
  );

  it.effect("does not recursively discover a new Reviewer Session transcript", () =>
    Effect.gen(function* () {
      const root = mkdtempSync(join(tmpdir(), "but-why-pi-reviewer-nested-"));
      const sessions = join(root, "sessions");
      const nested = join(sessions, "nested");
      mkdirSync(nested, { recursive: true });
      const sessionId = "123e4567-e89b-42d3-a456-426614174018";
      writeFileSync(
        join(nested, "nested.jsonl"),
        `${JSON.stringify({ type: "session", id: sessionId, cwd: input.commandCwd })}\n`,
      );
      const executor = createPiReviewerProcessExecutor(() =>
        Effect.succeed({
          exitCode: 0,
          stderr: "",
          stdout: `${JSON.stringify({ type: "session", id: sessionId })}\n${messageEvent(
            '<reviewer-output>{"findings":[]}</reviewer-output>',
            { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
          )}\n`,
        }),
      );

      try {
        const result = yield* executor.execute({ ...input, sessionStorageRoot: sessions });
        expect(result.sessionReference).toBe(sessionId);
        expect(result.sessionFilePath).toBeUndefined();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }),
  );

  it.effect("rejects ambiguous direct Reviewer Session transcripts", () =>
    Effect.gen(function* () {
      const root = mkdtempSync(join(tmpdir(), "but-why-pi-reviewer-ambiguous-"));
      const sessions = join(root, "sessions");
      mkdirSync(sessions);
      const nested = join(sessions, "nested");
      mkdirSync(nested);
      const sessionId = "123e4567-e89b-42d3-a456-426614174019";
      const header = `${JSON.stringify({ type: "session", id: sessionId, cwd: input.commandCwd })}\n`;
      writeFileSync(join(sessions, "one.jsonl"), header);
      writeFileSync(join(sessions, "two.jsonl"), header);
      writeFileSync(join(nested, "nested.jsonl"), header);
      const executor = createPiReviewerProcessExecutor(() =>
        Effect.succeed({
          exitCode: 0,
          stderr: "",
          stdout: `${JSON.stringify({ type: "session", id: sessionId })}\n${messageEvent(
            '<reviewer-output>{"findings":[]}</reviewer-output>',
            { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
          )}\n`,
        }),
      );

      try {
        const result = yield* Effect.either(
          executor.execute({ ...input, sessionStorageRoot: sessions }),
        );
        expect(result).toMatchObject({
          _tag: "Left",
          left: {
            sessionUsability: "unusable",
            message: expect.stringContaining("Multiple Reviewer Session transcripts"),
          },
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }),
  );

  it.effect("retains session metadata when Pi exits after starting a conversation", () =>
    Effect.gen(function* () {
      const root = mkdtempSync(join(tmpdir(), "but-why-pi-reviewer-failed-session-"));
      const sessions = join(root, "sessions");
      mkdirSync(sessions);
      const sessionId = "123e4567-e89b-42d3-a456-426614174001";
      const sessionFile = join(sessions, `review_${sessionId}.jsonl`);
      const executor = createPiReviewerProcessExecutor(() => {
        writeFileSync(
          sessionFile,
          `${JSON.stringify({ type: "session", id: sessionId, cwd: input.commandCwd })}\n`,
        );
        return Effect.succeed({
          exitCode: 1,
          stderr: "Pi stopped after creating the session.",
          stdout: `${JSON.stringify({ type: "session", id: sessionId })}\n`,
        });
      });

      try {
        const result = yield* Effect.either(
          executor.execute({ ...input, sessionStorageRoot: sessions, sessionId }),
        );
        expect(result).toMatchObject({
          _tag: "Left",
          left: {
            sessionReference: sessionId,
            sessionFilePath: sessionFile,
          },
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }),
  );

  it.effect("preserves transcript evidence written by a failed resumed invocation", () =>
    Effect.gen(function* () {
      const root = mkdtempSync(join(tmpdir(), "but-why-pi-reviewer-narrow-recovery-"));
      const sessions = join(root, "sessions");
      mkdirSync(sessions);
      const sessionId = "123e4567-e89b-42d3-a456-426614174002";
      const sessionFile = join(sessions, `review_${sessionId}.jsonl`);
      const original = `${JSON.stringify({ type: "session", id: sessionId, cwd: "/old" })}\n`;
      writeFileSync(sessionFile, original);
      const unrelatedFile = join(sessions, "unrelated.txt");
      writeFileSync(unrelatedFile, "before\n");
      const executor = createPiReviewerProcessExecutor(() => {
        appendFileSync(sessionFile, "partial transcript\n");
        appendFileSync(unrelatedFile, "after\n");
        return Effect.succeed({
          exitCode: 1,
          stderr: "Pi stopped after partial output.",
          stdout: `${JSON.stringify({ type: "session", id: sessionId })}\n${messageEvent(
            '<reviewer-output>{"findings":[]}</reviewer-output>',
            { input: 7, output: 2, cacheRead: 3, cacheWrite: 0, totalTokens: 12 },
          )}\n`,
        });
      });

      try {
        const result = yield* Effect.either(
          executor.execute({
            ...input,
            sessionStorageRoot: sessions,
            resumeSession: sessionId,
            resumeSessionFilePath: sessionFile,
          }),
        );
        expect(result).toMatchObject({
          _tag: "Left",
          left: {
            invocationUsage: {
              inputTokens: 7,
              cachedInputTokens: 3,
              cacheWriteTokens: 0,
              outputTokens: 2,
              totalTokens: 12,
            },
          },
        });
        expect(readFileSync(sessionFile, "utf8")).toBe(
          `${JSON.stringify({ type: "session", id: sessionId, cwd: input.commandCwd })}\npartial transcript\n`,
        );
        expect(readFileSync(unrelatedFile, "utf8")).toBe("before\nafter\n");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }),
  );

  it.effect("does not infer a conversation from an unused session ID", () =>
    Effect.gen(function* () {
      const root = mkdtempSync(join(tmpdir(), "but-why-pi-reviewer-unused-session-"));
      const sessions = join(root, "sessions");
      mkdirSync(sessions);
      const executor = createPiReviewerProcessExecutor(() =>
        Effect.succeed({
          exitCode: 1,
          stderr: "Pi failed before creating a session.",
          stdout: "",
        }),
      );

      try {
        const result = yield* Effect.either(
          executor.execute({
            ...input,
            sessionStorageRoot: sessions,
            sessionId: "by-agent-unused",
          }),
        );
        expect(result).toMatchObject({ _tag: "Left" });
        if (result._tag === "Right") return;
        expect(result.left.sessionReference).toBeUndefined();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }),
  );

  it.effect("rewrites only the resumed header and preserves later records", () =>
    Effect.gen(function* () {
      const root = mkdtempSync(join(tmpdir(), "but-why-pi-reviewer-"));
      const sessions = join(root, "sessions");
      mkdirSync(sessions);
      const sessionId = "123e4567-e89b-42d3-a456-426614174000";
      const sessionFile = join(sessions, `review_${sessionId}.jsonl`);
      writeFileSync(
        sessionFile,
        `${JSON.stringify({
          type: "session",
          id: sessionId,
          cwd: "/old/workspace",
          timestamp: "2026-08-11T20:00:00.000Z",
          version: 3,
          externalMetadata: { retained: true },
        })}\n{"type":"message"`,
      );
      let calls = 0;
      const executor = createPiReviewerProcessExecutor((command) => {
        calls += 1;
        const persistedSession = readFileSync(sessionFile, "utf8");
        expect(persistedSession).toContain('"cwd":"/validation/workspace"');
        expect(persistedSession).toContain('"timestamp":"2026-08-11T20:00:00.000Z"');
        expect(persistedSession).toContain('"externalMetadata":{"retained":true}');
        expect(persistedSession.endsWith('{"type":"message"')).toBe(true);
        expect(command.args).toContain("--session");
        expect(command.args).toContain(sessionFile);
        expect(command.args).toContain("--append-system-prompt");
        expect(command.args).toContain("Act as the Acceptance Reviewer.");
        return Effect.succeed({
          exitCode: 0,
          stderr: "",
          stdout: `${JSON.stringify({ type: "session", id: sessionId })}\n${messageEvent(
            `<reviewer-output>{"findings":[]}</reviewer-output>`,
            calls === 1
              ? { input: 11, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 13 }
              : { input: 4, output: 1, cacheRead: 9, cacheWrite: 0, totalTokens: 14 },
          )}\n`,
        });
      });

      try {
        const first = yield* executor.execute({
          ...input,
          sessionStorageRoot: sessions,
          resumeSession: sessionId,
          resumeSessionFilePath: sessionFile,
        });
        const second = yield* executor.execute({
          ...input,
          sessionStorageRoot: sessions,
          resumeSession: sessionId,
          resumeSessionFilePath: sessionFile,
          prompt: "Correct the output.",
        });

        expect(first.invocationUsage).toMatchObject({ inputTokens: 11, totalTokens: 13 });
        expect(second.invocationUsage).toMatchObject({
          inputTokens: 4,
          cachedInputTokens: 9,
          totalTokens: 14,
        });
        expect(calls).toBe(2);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }),
  );

  it.effect("represents unavailable invocation usage as null", () =>
    Effect.gen(function* () {
      const executor = createPiReviewerProcessExecutor(() =>
        Effect.succeed({
          exitCode: 0,
          stderr: "",
          stdout: `${messageEvent('<reviewer-output>{"findings":[]}</reviewer-output>')}\n`,
        }),
      );

      const result = yield* executor.execute(input);
      expect(result.invocationUsage).toBeNull();
    }),
  );

  it.effect("preserves optional message-field fallbacks", () =>
    Effect.gen(function* () {
      const executor = createPiReviewerProcessExecutor(() =>
        Effect.succeed({
          exitCode: 0,
          stderr: "",
          stdout: `${JSON.stringify({
            type: "message_end",
            message: {
              role: "assistant",
              usage: {
                input: 5,
                output: 3,
                cacheRead: 7,
                cacheWrite: 2,
                totalTokens: "unavailable",
              },
            },
          })}\n`,
        }),
      );

      const result = yield* executor.execute(input);

      expect(result).toMatchObject({
        stdout: "",
        invocationUsage: {
          inputTokens: 5,
          cachedInputTokens: 7,
          cacheWriteTokens: 2,
          outputTokens: 3,
          totalTokens: 17,
        },
      });
    }),
  );

  it.effect("classifies a confirmed missing resumed session as unusable", () =>
    Effect.gen(function* () {
      const root = mkdtempSync(join(tmpdir(), "but-why-missing-reviewer-session-"));
      try {
        const result = yield* Effect.either(
          createPiReviewerProcessExecutor(() => Effect.die("must not execute")).execute({
            ...input,
            sessionStorageRoot: root,
            resumeSession: "missing-session",
            resumeSessionFilePath: join(root, "missing.jsonl"),
          }),
        );
        expect(result).toMatchObject({
          _tag: "Left",
          left: { sessionUsability: "unusable" },
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }),
  );

  it.effect("rejects a resumed transcript outside session storage", () =>
    Effect.gen(function* () {
      const root = mkdtempSync(join(tmpdir(), "but-why-outside-reviewer-session-"));
      const sessions = join(root, "sessions");
      mkdirSync(sessions);
      const sessionId = "outside-session";
      const outside = join(root, "outside.jsonl");
      writeFileSync(
        outside,
        `${JSON.stringify({ type: "session", id: sessionId, cwd: input.commandCwd })}\n`,
      );
      try {
        const result = yield* Effect.either(
          createPiReviewerProcessExecutor(() => Effect.die("must not execute")).execute({
            ...input,
            sessionStorageRoot: sessions,
            resumeSession: sessionId,
            resumeSessionFilePath: outside,
          }),
        );
        expect(result).toMatchObject({
          _tag: "Left",
          left: {
            sessionUsability: "unusable",
            message: expect.stringContaining("is outside"),
          },
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }),
  );

  it.effect("preserves session storage inspection failures as unknown", () =>
    Effect.gen(function* () {
      const root = mkdtempSync(join(tmpdir(), "but-why-invalid-reviewer-session-root-"));
      const storageFile = join(root, "not-a-directory");
      writeFileSync(storageFile, "not a session directory");
      try {
        const result = yield* Effect.either(
          createPiReviewerProcessExecutor(() => Effect.die("must not execute")).execute({
            ...input,
            sessionStorageRoot: storageFile,
            resumeSession: "stored-session",
            resumeSessionFilePath: join(root, "stored.jsonl"),
          }),
        );
        expect(result).toMatchObject({
          _tag: "Left",
          left: {
            message: expect.stringContaining("is not a directory"),
            sessionUsability: "unknown",
          },
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }),
  );

  it.scoped("waits for reviewer process-tree termination when interrupted", () =>
    Effect.gen(function* () {
      const root = mkdtempSync(join(tmpdir(), "but-why-pi-reviewer-interrupt-"));
      const pidFile = join(root, "pid");
      const executor = createPiReviewerProcessExecutor(() =>
        executeHostCommandEffect({
          command: "sh",
          args: ["-c", `sleep 30 & child=$!; printf '%s' "$child" > '${pidFile}'; wait "$child"`],
        }),
      );
      try {
        const fiber = yield* Effect.fork(executor.execute(input));
        yield* Effect.promise(() => waitForFile(pidFile));
        const childPid = Number(readFileSync(pidFile, "utf8"));
        yield* Fiber.interrupt(fiber);
        yield* Effect.promise(() => waitForProcessExit(childPid));
        expect(processIsGone(childPid)).toBe(true);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }),
  );
});

const messageEvent = (
  text: string,
  usage?: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly totalTokens: number;
  },
): string =>
  JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      ...(usage === undefined ? {} : { usage }),
    },
  });

const waitForFile = (path: string): Promise<string> =>
  observeUntil({
    description: `file ${path} to contain a child PID`,
    observe: () => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return "";
      }
    },
    isReady: (contents) => contents.length > 0,
    timeoutMs: 5_000,
  });

const waitForProcessExit = (pid: number): Promise<boolean> =>
  observeUntil({
    description: `process ${pid} to exit`,
    observe: () => processIsGone(pid),
    timeoutMs: 5_000,
  });

const processIsGone = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
};
