import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";

import { createPiReviewerProcessExecutor } from "../../src/agent/piReviewerProcessExecutor.js";
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

      const result = yield* executor.effect({
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
          "--name",
          "acceptance Review",
          "Review the Candidate.",
        ],
        cwd: "/validation/workspace",
      });
      expect(result).toMatchObject({
        stdout: '<reviewer-output>{"findings":[]}</reviewer-output>',
        invocationUsage: {
          inputTokens: 7,
          cachedInputTokens: 7,
          outputTokens: 3,
          totalTokens: 17,
        },
      });
    }),
  );

  it.effect("retains a new Reviewer Session transcript", () =>
    Effect.gen(function* () {
      const root = mkdtempSync(join(tmpdir(), "but-why-pi-reviewer-transcript-"));
      const sessions = join(root, "sessions");
      mkdirSync(sessions);
      const sessionId = "123e4567-e89b-42d3-a456-426614174009";
      const sessionFile = join(sessions, `review_${sessionId}.jsonl`);
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
        const result = yield* executor.effect({ ...input, sessionStorageRoot: sessions });
        expect(result).toMatchObject({
          sessionReference: sessionId,
          sessionFilePath: sessionFile,
        });
        expect(result.resumeEffect).toBeTypeOf("function");
        expect(readFileSync(sessionFile, "utf8")).toContain(sessionId);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }),
  );

  it.effect("rewrites a resumed session cwd and keeps each invocation usage separate", () =>
    Effect.gen(function* () {
      const root = mkdtempSync(join(tmpdir(), "but-why-pi-reviewer-"));
      const sessions = join(root, "sessions");
      mkdirSync(sessions);
      const sessionId = "123e4567-e89b-42d3-a456-426614174000";
      const sessionFile = join(sessions, `review_${sessionId}.jsonl`);
      writeFileSync(
        sessionFile,
        `${JSON.stringify({ type: "session", id: sessionId, cwd: "/old/workspace" })}\n`,
      );
      let calls = 0;
      const executor = createPiReviewerProcessExecutor((command) => {
        calls += 1;
        expect(readFileSync(sessionFile, "utf8")).toContain('"cwd":"/validation/workspace"');
        expect(command.args).toContain("--session");
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
        const first = yield* executor.effect({
          ...input,
          sessionStorageRoot: sessions,
          resumeSession: sessionId,
        });
        if (first.resumeEffect === undefined) throw new Error("Expected reviewer continuation.");
        const second = yield* first.resumeEffect("Correct the output.");

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

      const result = yield* executor.effect(input);
      expect(result.invocationUsage).toBeNull();
    }),
  );

  it.effect("classifies a confirmed missing resumed session as unusable", () =>
    Effect.gen(function* () {
      const root = mkdtempSync(join(tmpdir(), "but-why-missing-reviewer-session-"));
      try {
        const result = yield* Effect.either(
          createPiReviewerProcessExecutor(() => Effect.die("must not execute")).effect({
            ...input,
            sessionStorageRoot: root,
            resumeSession: "missing-session",
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

  it.effect("preserves session storage inspection failures as unknown", () =>
    Effect.gen(function* () {
      const root = mkdtempSync(join(tmpdir(), "but-why-invalid-reviewer-session-root-"));
      const storageFile = join(root, "not-a-directory");
      writeFileSync(storageFile, "not a session directory");
      try {
        const result = yield* Effect.either(
          createPiReviewerProcessExecutor(() => Effect.die("must not execute")).effect({
            ...input,
            sessionStorageRoot: storageFile,
            resumeSession: "stored-session",
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
        const fiber = yield* Effect.fork(executor.effect?.(input) ?? Effect.void);
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
