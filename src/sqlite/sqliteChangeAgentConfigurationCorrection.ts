import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import { internalChangeId } from "../change/changeId.js";

export const changeReviewerConfigurationCanBeCorrected = (
  sql: SqlClient.SqlClient,
  changeId: string,
  producer: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const sessions = yield* sql<{ readonly agentSessionId: number }>`
      SELECT agent_session_id AS agentSessionId
      FROM change_agent_sessions
      WHERE change_id = ${internalChangeId(changeId, idPrefix)} AND producer = ${producer}
    `;
    const sessionId = sessions[0]?.agentSessionId;
    return sessionId === undefined
      ? false
      : yield* agentSessionConfigurationCanBeCorrected(sql, sessionId);
  });

export const agentSessionConfigurationCanBeCorrected = (
  sql: SqlClient.SqlClient,
  sessionId: number,
  excludedInvocationId?: number,
) =>
  Effect.gen(function* () {
    const invocationPredicate =
      excludedInvocationId === undefined
        ? sql``
        : sql`AND invocation.id <> ${excludedInvocationId}`;
    const latest = yield* sql<{
      readonly settlementKind: string | null;
      readonly transcriptPath: string | null;
    }>`
      SELECT invocation.settlement_kind AS settlementKind,
        continuation.transcript_path AS transcriptPath
      FROM agent_invocations AS invocation
      JOIN agent_continuations AS continuation
        ON continuation.id = invocation.continuation_id
      WHERE continuation.agent_session_id = ${sessionId}
        ${invocationPredicate}
      ORDER BY invocation.id DESC LIMIT 1
    `;
    const transcript = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM agent_continuations
      WHERE agent_session_id = ${sessionId} AND transcript_path IS NOT NULL
    `;
    const returned = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count
      FROM agent_invocations AS invocation
      JOIN agent_continuations AS continuation
        ON continuation.id = invocation.continuation_id
      WHERE continuation.agent_session_id = ${sessionId}
        ${invocationPredicate}
        AND invocation.settlement_kind = 'returned'
    `;
    return (
      latest[0]?.settlementKind === "launch_failed" &&
      latest[0]?.transcriptPath === null &&
      (transcript[0]?.count ?? 0) === 0 &&
      (returned[0]?.count ?? 0) === 0
    );
  });
