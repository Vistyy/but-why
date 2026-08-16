import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type {
  AgentSessionConfiguration,
  AgentSessionPersistence,
  AgentSessionSqlLink,
} from "../../src/agent/agentSession/agentSession.js";
import { executeAgentSession } from "../../src/agent/agentSession/executeAgentSession.js";
import {
  RepositoryPersistedDataInvalid,
  type RepositoryStorageError,
} from "../../src/contracts/repositoryStorageError.js";
import { openRepositoryRuntime } from "../../src/repositoryRuntime/repositoryRuntime.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import {
  openSqliteAgentSessionPersistence,
  settleUnsettledAgentInvocations,
} from "../../src/sqlite/sqliteAgentSessionPersistence.js";
import { createGitRepo, runByInProcessEffect } from "../support/by-cli.js";

const configuration: AgentSessionConfiguration = {
  harness: "pi",
  provider: null,
  model: "provider/model",
  thinking: "medium",
};

const noOpLink: AgentSessionSqlLink = () => Effect.void;

const withPersistence = <A, E>(
  root: string,
  use: (persistence: AgentSessionPersistence) => Effect.Effect<A, E, RepositorySql>,
): Effect.Effect<A, E | RepositoryStorageError, never> => {
  const loaded = openRepositoryRuntime(root);
  if (!loaded.ok) throw new Error(loaded.error.code);
  return loaded.runtime.provide(
    openSqliteAgentSessionPersistence().pipe(Effect.flatMap((persistence) => use(persistence))),
  );
};

const initializedRepository = () =>
  Effect.gen(function* () {
    const root = createGitRepo();
    const initialized = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);
    expect(initialized.status, initialized.stdout).toBe(0);
    return root;
  });

it.effect("records and resumes a usable Agent Continuation with exact token evidence", () =>
  Effect.gen(function* () {
    const root = yield* initializedRepository();
    yield* withPersistence(root, (persistence) =>
      Effect.gen(function* () {
        const first = yield* persistence.beginInvocation({
          configuration,
          createdAt: "2026-08-14T12:00:00.000Z",
          linkInvocation: noOpLink,
        });
        expect(first).toMatchObject({ ok: true });
        if (!first.ok) return;
        yield* persistence.settleInvocation({
          invocationId: first.dispatch.invocation.id,
          continuationId: first.dispatch.continuation.id,
          settlement: {
            settledAt: "2026-08-14T12:00:01.000Z",
            kind: "returned",
            usage: {
              inputTokens: 10,
              cachedInputTokens: 2,
              cacheWriteTokens: 3,
              outputTokens: 4,
              totalTokens: 19,
            },
            transcriptPath: "sessions/one.jsonl",
          },
        });

        const resumed = yield* persistence.beginInvocation({
          agentSessionId: first.dispatch.agentSessionId,
          configuration,
          createdAt: "2026-08-14T12:00:02.000Z",
          linkInvocation: noOpLink,
        });
        expect(resumed).toMatchObject({
          ok: true,
          dispatch: {
            resumed: true,
            continuation: { id: first.dispatch.continuation.id },
            piSessionId: `by-agent-${first.dispatch.continuation.id}`,
          },
        });
        if (!resumed.ok) return;
        const history = yield* persistence.readInvocationHistory(first.dispatch.agentSessionId);
        expect(history).toHaveLength(2);
        expect(history[0]).toMatchObject({
          settlementKind: "returned",
          usage: {
            inputTokens: 10,
            cachedInputTokens: 2,
            cacheWriteTokens: 3,
            outputTokens: 4,
            totalTokens: 19,
          },
          continuation: {
            harness: "pi",
            provider: null,
            model: "provider/model",
            thinking: "medium",
            transcriptPath: "sessions/one.jsonl",
          },
        });
      }),
    );
  }),
);

it.effect("rejects concurrent unsettled dispatch and rolls back failed domain settlement", () =>
  Effect.gen(function* () {
    const root = yield* initializedRepository();
    yield* withPersistence(root, (persistence) =>
      Effect.gen(function* () {
        const first = yield* persistence.beginInvocation({
          configuration,
          createdAt: "2026-08-14T12:00:00.000Z",
          linkInvocation: noOpLink,
        });
        expect(first).toMatchObject({ ok: true });
        if (!first.ok) return;
        const concurrent = yield* persistence.beginInvocation({
          agentSessionId: first.dispatch.agentSessionId,
          configuration,
          createdAt: "2026-08-14T12:00:01.000Z",
          linkInvocation: noOpLink,
        });
        expect(concurrent).toEqual({ ok: false, code: "concurrent_unsettled_invocation" });

        const failed = yield* Effect.exit(
          persistence.settleInvocation({
            invocationId: first.dispatch.invocation.id,
            continuationId: first.dispatch.continuation.id,
            settlement: {
              settledAt: "2026-08-14T12:00:02.000Z",
              kind: "failed",
            },
            settleDomain: () =>
              Effect.fail(
                new RepositoryPersistedDataInvalid({
                  operationName: "settle test domain result",
                  cause: new Error("domain result failed"),
                }),
              ),
          }),
        );
        expect(failed._tag).toBe("Failure");
        const rolledBack = yield* persistence.readInvocationHistory(first.dispatch.agentSessionId);
        expect(rolledBack[0]).toMatchObject({ settledAt: null, settlementKind: null });
        yield* persistence.settleInvocation({
          invocationId: first.dispatch.invocation.id,
          continuationId: first.dispatch.continuation.id,
          settlement: {
            settledAt: "2026-08-14T12:00:03.000Z",
            kind: "failed",
          },
        });
        const retry = yield* persistence.beginInvocation({
          agentSessionId: first.dispatch.agentSessionId,
          configuration,
          createdAt: "2026-08-14T12:00:04.000Z",
          linkInvocation: noOpLink,
        });
        expect(retry).toMatchObject({ ok: true, dispatch: { invocation: { id: 2 } } });
      }),
    );
  }),
);

it.effect(
  "appends a replacement continuation after launch failure and keeps configuration fixed after return",
  () =>
    Effect.gen(function* () {
      const root = yield* initializedRepository();
      yield* withPersistence(root, (persistence) =>
        Effect.gen(function* () {
          const first = yield* persistence.beginInvocation({
            configuration,
            createdAt: "2026-08-14T12:00:00.000Z",
            linkInvocation: noOpLink,
          });
          if (!first.ok) return;
          yield* persistence.settleInvocation({
            invocationId: first.dispatch.invocation.id,
            continuationId: first.dispatch.continuation.id,
            settlement: {
              settledAt: "2026-08-14T12:00:01.000Z",
              kind: "launch_failed",
              unusableReason: "model unavailable",
            },
          });
          const corrected = yield* persistence.beginInvocation({
            agentSessionId: first.dispatch.agentSessionId,
            configuration: { ...configuration, model: "provider/corrected" },
            createdAt: "2026-08-14T12:00:02.000Z",
            linkInvocation: noOpLink,
          });
          expect(corrected).toMatchObject({
            ok: true,
            dispatch: { resumed: false, continuation: { model: "provider/corrected" } },
          });
          if (!corrected.ok) return;
          yield* persistence.settleInvocation({
            invocationId: corrected.dispatch.invocation.id,
            continuationId: corrected.dispatch.continuation.id,
            settlement: {
              settledAt: "2026-08-14T12:00:03.000Z",
              kind: "returned",
              transcriptPath: "sessions/corrected.jsonl",
            },
          });
          const rejected = yield* Effect.exit(
            persistence.beginInvocation({
              agentSessionId: first.dispatch.agentSessionId,
              configuration: { ...configuration, model: "provider/another" },
              createdAt: "2026-08-14T12:00:04.000Z",
              linkInvocation: noOpLink,
            }),
          );
          expect(rejected._tag).toBe("Failure");
        }),
      );
    }),
);

it.effect("does not resume a continuation marked unusable despite its transcript", () =>
  Effect.gen(function* () {
    const root = yield* initializedRepository();
    const transcript = join(root, "unusable-continuation.jsonl");
    writeFileSync(transcript, "known transcript\n");
    yield* withPersistence(root, (persistence) =>
      Effect.gen(function* () {
        const result = yield* executeAgentSession({
          configuration,
          agentPersistence: persistence,
          linkInvocation: noOpLink,
          reviewerRuntime: {
            review: () =>
              Effect.succeed({
                ok: false as const,
                failure: {
                  kind: "process_execution" as const,
                  operationName: "run_reviewer_process",
                  message: "The continuation is corrupt.",
                  sessionUsability: "unusable" as const,
                  sessionReference: "known-session",
                  sessionFilePath: transcript,
                },
                sessionUsability: "unusable" as const,
                attempts: 1,
                stdout: "partial output",
                sessionReference: "known-session",
                sessionFilePath: transcript,
                invocationUsage: [
                  {
                    inputTokens: 4,
                    cachedInputTokens: 1,
                    cacheWriteTokens: 0,
                    outputTokens: 2,
                    totalTokens: 7,
                  },
                ],
              }),
          },
          reviewerExecutor: { execute: () => Effect.die("Reviewer process must not run") },
          decodeOutput: (output) => Effect.succeed(output),
          prompt: "Review.",
          continuationPrompt: "Continue.",
          commandCwd: root,
          resourceRoot: root,
          profile: {
            agentProfile: "review",
            scope: "global",
            profile: { agentRuntime: "pi", runtimeConfig: { model: configuration.model } },
          },
          reviewer: "test",
          sessionStorageRoot: root,
        });
        expect(result.result).toMatchObject({ ok: false, sessionUsability: "unusable" });
        expect(result.evidence.invocations).toMatchObject([
          {
            settlementKind: "failed",
            usage: {
              inputTokens: 4,
              cachedInputTokens: 1,
              cacheWriteTokens: 0,
              outputTokens: 2,
              totalTokens: 7,
            },
            continuation: {
              transcriptPath: "unusable-continuation.jsonl",
              unusableReason: "The continuation is corrupt.",
            },
          },
        ]);
        const resumed = yield* persistence.beginInvocation({
          agentSessionId: result.evidence.agentSessionId,
          configuration,
          createdAt: "2026-08-14T12:00:02.000Z",
          linkInvocation: noOpLink,
        });
        expect(resumed).toMatchObject({ ok: true, dispatch: { resumed: false } });
      }),
    );
  }),
);

it.effect("discovers an initial transcript after interruption and keeps it resumable", () =>
  Effect.gen(function* () {
    const root = yield* initializedRepository();
    yield* withPersistence(root, (persistence) =>
      Effect.gen(function* () {
        const transcript = join(root, "interrupted-initial.jsonl");
        const result = yield* executeAgentSession({
          configuration,
          agentPersistence: persistence,
          linkInvocation: noOpLink,
          reviewerRuntime: {
            review: (reviewInput) => {
              writeFileSync(
                transcript,
                `${JSON.stringify({
                  type: "session",
                  id: reviewInput.sessionId,
                  cwd: root,
                })}\n`,
              );
              return Effect.interrupt;
            },
          },
          reviewerExecutor: { execute: () => Effect.die("Reviewer process must not run") },
          decodeOutput: (output) => Effect.succeed(output),
          prompt: "Review.",
          continuationPrompt: "Continue.",
          commandCwd: root,
          resourceRoot: root,
          profile: {
            agentProfile: "review",
            scope: "global",
            profile: { agentRuntime: "pi", runtimeConfig: { model: configuration.model } },
          },
          reviewer: "test",
          sessionStorageRoot: root,
        });

        expect(result.result).toMatchObject({
          ok: false,
          sessionFilePath: transcript,
        });
        expect(result.evidence.invocations).toMatchObject([
          {
            settlementKind: "return_unknown",
            continuation: {
              transcriptPath: "interrupted-initial.jsonl",
              unusableReason: null,
            },
          },
        ]);
        const resumed = yield* persistence.beginInvocation({
          agentSessionId: result.evidence.agentSessionId,
          configuration,
          createdAt: "2026-08-14T12:00:02.000Z",
          linkInvocation: noOpLink,
        });
        expect(resumed).toMatchObject({ ok: true, dispatch: { resumed: true } });
      }),
    );
  }),
);

it.effect("keeps an interrupted invocation resumable when its transcript is known", () =>
  Effect.gen(function* () {
    const root = yield* initializedRepository();
    yield* withPersistence(root, (persistence) =>
      Effect.gen(function* () {
        const started = yield* persistence.beginInvocation({
          configuration,
          createdAt: "2026-08-14T12:00:00.000Z",
          linkInvocation: noOpLink,
        });
        expect(started).toMatchObject({ ok: true });
        if (!started.ok) return;
        const repository = yield* RepositorySql;
        yield* repository.transactionImmediate("record interrupted Agent transcript", (sql) =>
          Effect.gen(function* () {
            yield* sql`
                UPDATE agent_continuations
                SET transcript_path = 'sessions/interrupted.jsonl'
                WHERE id = ${started.dispatch.continuation.id}
              `;
            yield* settleUnsettledAgentInvocations(
              sql,
              [started.dispatch.invocation.id],
              "2026-08-14T12:00:01.000Z",
              "The interrupted process stopped.",
            );
          }),
        );
        const history = yield* persistence.readInvocationHistory(started.dispatch.agentSessionId);
        expect(history).toMatchObject([
          {
            settlementKind: "return_unknown",
            continuation: {
              transcriptPath: "sessions/interrupted.jsonl",
              unusableReason: null,
            },
          },
        ]);
        const resumed = yield* persistence.beginInvocation({
          agentSessionId: started.dispatch.agentSessionId,
          configuration,
          createdAt: "2026-08-14T12:00:02.000Z",
          linkInvocation: noOpLink,
        });
        expect(resumed).toMatchObject({ ok: true, dispatch: { resumed: true } });
      }),
    );
  }),
);
