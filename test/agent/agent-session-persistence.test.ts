import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type {
  AgentSessionConfiguration,
  AgentSessionPersistence,
  AgentSessionSqlLink,
} from "../../src/agent/agentSession/agentSession.js";
import {
  RepositoryPersistedDataInvalid,
  type RepositoryStorageError,
} from "../../src/contracts/repositoryStorageError.js";
import { openRepositoryRuntime } from "../../src/repositoryRuntime/repositoryRuntime.js";
import { openSqliteAgentSessionPersistence } from "../../src/sqlite/sqliteAgentSessionPersistence.js";
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
  use: (persistence: AgentSessionPersistence) => Effect.Effect<A, E, never>,
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
            usage: { inputTokens: 10, cachedInputTokens: 2, outputTokens: 4, totalTokens: 16 },
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
          usage: { inputTokens: 10, cachedInputTokens: 2, outputTokens: 4, totalTokens: 16 },
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
