import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import type {
  AgentContinuationRecord,
  AgentDispatchResult,
  AgentInvocationRecord,
  AgentInvocationSettlement,
  AgentSessionConfiguration,
  AgentSessionPersistence,
} from "../agent/agentSession/agentSession.js";
import { piSessionIdForContinuation } from "../agent/agentSession/agentSession.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { RepositorySql } from "./repositorySql.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";

const positiveIntegerMax = 9_007_199_254_740_991;

type ContinuationRow = {
  readonly id: number;
  readonly agentSessionId: number;
  readonly harness: string;
  readonly provider: string | null;
  readonly model: string;
  readonly thinking: string | null;
  readonly transcriptPath: string | null;
  readonly unusableReason: string | null;
};

type InvocationRow = {
  readonly id: number;
  readonly agentSessionId: number;
  readonly continuationId: number;
  readonly createdAt: string;
  readonly settledAt: string | null;
  readonly settlementKind: string | null;
  readonly inputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly cacheWriteTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly harness: string;
  readonly provider: string | null;
  readonly model: string;
  readonly thinking: string | null;
  readonly transcriptPath: string | null;
  readonly unusableReason: string | null;
};

export const openSqliteAgentSessionPersistence = (): Effect.Effect<
  AgentSessionPersistence,
  never,
  RepositorySql
> =>
  Effect.map(
    RepositorySql,
    (repository): AgentSessionPersistence => ({
      beginInvocation: (input) =>
        repository.transactionImmediate("dispatch Agent Invocation", (sql) =>
          beginInvocation(sql, input),
        ),
      settleInvocation: (input) =>
        repository.transactionImmediate("settle Agent Invocation", (sql) =>
          settleInvocation(sql, input),
        ),
      readInvocationHistory: (agentSessionId) =>
        repository.transaction("read Agent Invocation history", (sql) =>
          readInvocationHistory(sql, agentSessionId),
        ),
    }),
  );

const beginInvocation = (
  sql: SqlClient.SqlClient,
  input: Parameters<AgentSessionPersistence["beginInvocation"]>[0],
) =>
  Effect.gen(function* () {
    if (input.configuration.model.trim().length === 0) {
      return yield* invalid("dispatch Agent Invocation", "Agent model must not be blank");
    }
    const unsettled = yield* sql<{ readonly id: number }>`
      SELECT invocation.id
      FROM agent_invocations AS invocation
      JOIN agent_continuations AS continuation
        ON continuation.id = invocation.continuation_id
      WHERE continuation.agent_session_id = ${input.agentSessionId ?? -1}
        AND invocation.settled_at IS NULL
      LIMIT 1
    `;
    if (unsettled.length > 0)
      return { ok: false, code: "concurrent_unsettled_invocation" } as const;

    let sessionId = input.agentSessionId;
    if (sessionId === undefined) {
      const created = yield* sql<{ readonly id: number }>`
        INSERT INTO agent_sessions DEFAULT VALUES RETURNING id
      `;
      sessionId = created[0]?.id;
      if (sessionId === undefined)
        return yield* invalid("dispatch Agent Invocation", "Agent Session was not created");
    }

    const currentRows = yield* sql<ContinuationRow>`
      SELECT id, agent_session_id AS agentSessionId, harness, provider, model,
        thinking, transcript_path AS transcriptPath, unusable_reason AS unusableReason
      FROM agent_continuations
      WHERE agent_session_id = ${sessionId}
      ORDER BY id DESC LIMIT 1
    `;
    const current = currentRows[0];
    const currentConfiguration = yield* decodePersisted(
      "dispatch Agent Invocation",
      (): AgentSessionConfiguration | undefined =>
        current === undefined
          ? undefined
          : {
              harness: decodeHarness(current.harness),
              provider: current.provider,
              model: requiredModel(current.model),
              thinking: current.thinking === null ? null : decodeThinking(current.thinking),
            },
    );
    if (
      current !== undefined &&
      currentConfiguration !== undefined &&
      !sameConfiguration(currentConfiguration, input.configuration)
    ) {
      return yield* invalid(
        "dispatch Agent Invocation",
        "Agent Session configuration is immutable",
      );
    }
    const continuation =
      current !== undefined &&
      current.transcriptPath !== null &&
      current.unusableReason === null &&
      currentConfiguration !== undefined &&
      sameConfiguration(currentConfiguration, input.configuration)
        ? yield* decodePersisted("dispatch Agent Invocation", () => decodeContinuation(current))
        : yield* createContinuation(sql, sessionId, normalizeConfiguration(input.configuration));

    const created = yield* sql<{ readonly id: number }>`
      INSERT INTO agent_invocations (continuation_id, created_at)
      VALUES (${continuation.id}, ${input.createdAt})
      RETURNING id
    `;
    const invocationId = created[0]?.id;
    if (invocationId === undefined)
      return yield* invalid("dispatch Agent Invocation", "Invocation was not created");
    yield* input.linkInvocation(sql, invocationId);

    const invocation: AgentInvocationRecord = {
      id: invocationId,
      continuationId: continuation.id,
      createdAt: input.createdAt,
      settledAt: null,
      settlementKind: null,
      usage: null,
      continuation,
    };
    return {
      ok: true,
      dispatch: {
        agentSessionId: sessionId,
        continuation,
        invocation,
        resumed: current !== undefined && continuation.id === current.id,
        piSessionId: piSessionIdForContinuation(continuation.id),
      },
    } satisfies AgentDispatchResult;
  });

const normalizeConfiguration = (
  configuration: AgentSessionConfiguration,
): AgentSessionConfiguration => ({
  harness: configuration.harness,
  provider: configuration.provider ?? null,
  model: configuration.model,
  thinking: configuration.thinking ?? null,
});

const sameConfiguration = (
  left: AgentSessionConfiguration,
  right: AgentSessionConfiguration,
): boolean =>
  left.harness === right.harness &&
  (left.provider ?? null) === (right.provider ?? null) &&
  left.model === right.model &&
  (left.thinking ?? null) === (right.thinking ?? null);

const createContinuation = (
  sql: SqlClient.SqlClient,
  agentSessionId: number,
  configuration: AgentSessionConfiguration,
) =>
  Effect.map(
    sql<{ readonly id: number }>`
      INSERT INTO agent_continuations (agent_session_id, harness, provider, model, thinking)
      VALUES (
        ${agentSessionId}, ${configuration.harness}, ${configuration.provider ?? null},
        ${configuration.model}, ${configuration.thinking ?? null}
      ) RETURNING id
    `,
    (rows): AgentContinuationRecord => {
      const id = rows[0]?.id;
      if (id === undefined) throw new Error("Agent Continuation was not created");
      return {
        id,
        agentSessionId,
        harness: configuration.harness,
        provider: configuration.provider ?? null,
        model: configuration.model,
        thinking: configuration.thinking ?? null,
        transcriptPath: null,
        unusableReason: null,
      };
    },
  );

const settleInvocation = (
  sql: SqlClient.SqlClient,
  input: Parameters<AgentSessionPersistence["settleInvocation"]>[0],
) =>
  Effect.gen(function* () {
    const usage = input.settlement.usage;
    const found = yield* sql<{ readonly settledAt: string | null }>`
      SELECT settled_at AS settledAt
      FROM agent_invocations
      WHERE id = ${input.invocationId} AND continuation_id = ${input.continuationId}
    `;
    const existing = found[0];
    if (existing === undefined)
      return yield* invalid("settle Agent Invocation", "Invocation was not found");
    if (existing.settledAt !== null)
      return yield* invalid("settle Agent Invocation", "Agent Invocation is already settled");
    yield* sql`
      UPDATE agent_invocations
      SET settled_at = ${input.settlement.settledAt},
          settlement_kind = ${input.settlement.kind},
          input_tokens = ${usage?.inputTokens ?? null},
          cached_input_tokens = ${usage?.cachedInputTokens ?? null},
          cache_write_tokens = ${usage?.cacheWriteTokens ?? null},
          output_tokens = ${usage?.outputTokens ?? null},
          total_tokens = ${usage?.totalTokens ?? null}
      WHERE id = ${input.invocationId}
        AND continuation_id = ${input.continuationId}
        AND settled_at IS NULL
    `;
    if (
      input.settlement.transcriptPath !== undefined ||
      input.settlement.unusableReason !== undefined
    ) {
      yield* sql`
        UPDATE agent_continuations
        SET transcript_path = COALESCE(${input.settlement.transcriptPath ?? null}, transcript_path),
            unusable_reason = COALESCE(${input.settlement.unusableReason ?? null}, unusable_reason)
        WHERE id = ${input.continuationId}
      `;
    }
    if (input.settleDomain !== undefined) yield* input.settleDomain(sql, input.invocationId);
  });

export const settleUnsettledAgentInvocations = (
  sql: SqlClient.SqlClient,
  invocationIds: readonly number[],
  settledAt: string,
  unusableReason: string,
) =>
  Effect.gen(function* () {
    for (const invocationId of invocationIds) {
      const rows = yield* sql<{
        readonly continuationId: number;
        readonly settledAt: string | null;
        readonly transcriptPath: string | null;
      }>`
        SELECT invocation.continuation_id AS continuationId,
          invocation.settled_at AS settledAt,
          continuation.transcript_path AS transcriptPath
        FROM agent_invocations AS invocation
        JOIN agent_continuations AS continuation
          ON continuation.id = invocation.continuation_id
        WHERE invocation.id = ${invocationId}
      `;
      const invocation = rows[0];
      if (invocation === undefined) {
        return yield* invalid(
          "settle interrupted Agent Invocations",
          `Agent Invocation ${invocationId} was not found`,
        );
      }
      if (invocation.settledAt !== null) continue;
      yield* sql`
        UPDATE agent_invocations
        SET settled_at = ${settledAt},
            settlement_kind = 'return_unknown',
            input_tokens = NULL,
            cached_input_tokens = NULL,
            cache_write_tokens = NULL,
            output_tokens = NULL,
            total_tokens = NULL
        WHERE id = ${invocationId} AND settled_at IS NULL
      `;
      if (invocation.transcriptPath === null) {
        yield* sql`
          UPDATE agent_continuations
          SET unusable_reason = COALESCE(unusable_reason, ${unusableReason})
          WHERE id = ${invocation.continuationId}
        `;
      }
    }
  }).pipe(Effect.asVoid);

const readInvocationHistory = (sql: SqlClient.SqlClient, agentSessionId: number) =>
  Effect.gen(function* () {
    const rows = yield* sql<InvocationRow>`
      SELECT invocation.id, continuation.agent_session_id AS agentSessionId,
        invocation.continuation_id AS continuationId,
        invocation.created_at AS createdAt, invocation.settled_at AS settledAt,
        invocation.settlement_kind AS settlementKind,
        invocation.input_tokens AS inputTokens,
        invocation.cached_input_tokens AS cachedInputTokens,
        invocation.cache_write_tokens AS cacheWriteTokens,
        invocation.output_tokens AS outputTokens,
        invocation.total_tokens AS totalTokens,
        continuation.harness,
        continuation.provider,
        continuation.model,
        continuation.thinking,
        continuation.transcript_path AS transcriptPath,
        continuation.unusable_reason AS unusableReason
      FROM agent_invocations AS invocation
      JOIN agent_continuations AS continuation ON continuation.id = invocation.continuation_id
      WHERE continuation.agent_session_id = ${agentSessionId}
      ORDER BY invocation.id
    `;
    return yield* decodePersisted("read Agent Invocation history", () =>
      rows.map(decodeInvocation),
    );
  });

const decodeContinuation = (row: ContinuationRow): AgentContinuationRecord => ({
  id: row.id,
  agentSessionId: row.agentSessionId,
  harness: decodeHarness(row.harness),
  provider: row.provider,
  model: requiredModel(row.model),
  thinking: row.thinking === null ? null : (decodeThinking(row.thinking) ?? null),
  transcriptPath: row.transcriptPath,
  unusableReason: row.unusableReason,
});

const decodeInvocation = (row: InvocationRow): AgentInvocationRecord => {
  const usagePresent =
    row.inputTokens !== null ||
    row.cachedInputTokens !== null ||
    row.cacheWriteTokens !== null ||
    row.outputTokens !== null ||
    row.totalTokens !== null;
  const usage = usagePresent
    ? {
        inputTokens: requiredToken(row.inputTokens),
        cachedInputTokens: requiredToken(row.cachedInputTokens),
        cacheWriteTokens: requiredToken(row.cacheWriteTokens),
        outputTokens: requiredToken(row.outputTokens),
        totalTokens: requiredToken(row.totalTokens),
      }
    : null;
  return {
    id: row.id,
    continuationId: row.continuationId,
    createdAt: row.createdAt,
    settledAt: row.settledAt,
    settlementKind: row.settlementKind === null ? null : decodeSettlementKind(row.settlementKind),
    usage,
    continuation: {
      id: row.continuationId,
      agentSessionId: row.agentSessionId,
      harness: decodeHarness(row.harness),
      provider: row.provider,
      model: requiredModel(row.model),
      thinking: row.thinking === null ? null : decodeThinking(row.thinking),
      transcriptPath: row.transcriptPath,
      unusableReason: row.unusableReason,
    },
  };
};

const requiredModel = (value: string): string => {
  if (value.trim().length === 0) throw new Error("Agent model is blank");
  return value;
};
const decodeHarness = (value: string): "pi" => {
  if (value !== "pi") throw new Error(`Unsupported Agent Harness: ${value}`);
  return "pi";
};
const decodeThinking = (value: string): NonNullable<AgentSessionConfiguration["thinking"]> => {
  if (!["off", "minimal", "low", "medium", "high", "xhigh"].includes(value))
    throw new Error(`Invalid Agent thinking level: ${value}`);
  return value as NonNullable<AgentSessionConfiguration["thinking"]>;
};
const decodeSettlementKind = (value: string): AgentInvocationSettlement["kind"] => {
  if (!["returned", "launch_failed", "failed", "return_unknown"].includes(value))
    throw new Error(`Invalid Agent Invocation settlement kind: ${value}`);
  return value as AgentInvocationSettlement["kind"];
};
const requiredToken = (value: number | null): number => {
  if (value === null || !Number.isSafeInteger(value) || value < 0 || value > positiveIntegerMax)
    throw new Error("Agent Invocation token evidence is incomplete");
  return value;
};
const invalid = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
