import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import type { ChangeReviewerSessionPort } from "../change/changePorts.js";
import type { ChangeReviewerConfiguration } from "../change/changeStartStore.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { RepositorySql } from "./repositorySql.js";
import { decodeReviewerSession, type StoredReviewerSessionRow } from "./sqliteChangeReadModel.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";

export const openSqliteChangeReviewerSessionPort = () =>
  Effect.map(
    RepositorySql,
    (repository): ChangeReviewerSessionPort => ({
      getAgentSession: (changeId, producer) =>
        repository.transaction("read Change Agent Session", (sql) =>
          Effect.map(
            sql<{ readonly agentSessionId: number }>`
            SELECT agent_session_id AS agentSessionId
            FROM change_agent_sessions
            WHERE change_id = ${changeId} AND producer = ${producer}
          `,
            (rows) => rows[0]?.agentSessionId ?? undefined,
          ),
        ),
      linkAgentInvocation: (input) => (sql, invocationId) =>
        Effect.gen(function* () {
          const sessions = yield* sql<{ readonly agentSessionId: number }>`
          SELECT continuation.agent_session_id AS agentSessionId
          FROM agent_invocations AS invocation
          JOIN agent_continuations AS continuation ON continuation.id = invocation.continuation_id
          WHERE invocation.id = ${invocationId}
        `;
          const sessionId = sessions[0]?.agentSessionId;
          if (sessionId === undefined)
            return yield* Effect.fail(
              new RepositoryPersistedDataInvalid({
                operationName: "link Change Agent Invocation",
                cause: new Error("Invocation Session is missing"),
              }),
            );
          const taskOwners = yield* sql<{ readonly taskId: string }>`
            SELECT id AS taskId FROM tasks WHERE reviewer_agent_session_id = ${sessionId}
          `;
          if (taskOwners.length > 0)
            return yield* Effect.fail(
              new RepositoryPersistedDataInvalid({
                operationName: "link Change Agent Invocation",
                cause: new Error("Agent Session already has another owner"),
              }),
            );
          const existingOwners = yield* sql<{ readonly agentSessionId: number }>`
            SELECT agent_session_id AS agentSessionId
            FROM change_agent_sessions
            WHERE change_id = ${input.changeId} AND producer = ${input.producer}
          `;
          if (existingOwners[0] !== undefined && existingOwners[0].agentSessionId !== sessionId)
            return yield* Effect.fail(
              new RepositoryPersistedDataInvalid({
                operationName: "link Change Agent Invocation",
                cause: new Error("Change role already has another Agent Session"),
              }),
            );
          const canCorrect =
            input.configurationSnapshot === undefined
              ? false
              : yield* changeAgentConfigurationCanBeCorrected(sql, sessionId, invocationId);
          if (canCorrect) {
            const configurations = yield* sql<{ readonly configuration: string | null }>`
              SELECT reviewer_configuration AS configuration FROM changes WHERE id = ${input.changeId}
            `;
            const configuration = configurations[0]?.configuration;
            if (configuration !== undefined && configuration !== null) {
              const replacement = yield* Effect.try({
                try: () => {
                  const decoded: unknown = JSON.parse(configuration) as unknown;
                  return replaceChangeRoleConfiguration(
                    decoded as ChangeReviewerConfiguration,
                    input.producer,
                    input.configurationSnapshot,
                  );
                },
                catch: (cause) =>
                  new RepositoryPersistedDataInvalid({
                    operationName: "correct Change Agent configuration",
                    cause,
                  }),
              });
              yield* sql`
                UPDATE changes SET reviewer_configuration = ${JSON.stringify(replacement)}
                WHERE id = ${input.changeId}
              `;
            }
          }
          yield* sql`
          INSERT INTO change_agent_sessions (change_id, producer, agent_session_id)
          VALUES (${input.changeId}, ${input.producer}, ${sessionId})
          ON CONFLICT(change_id, producer) DO NOTHING
        `;
          yield* sql`
          INSERT INTO validation_phase_agent_invocations (
            validation_run_id, phase, producer, agent_invocation_id
          ) VALUES (${input.validationRunId}, ${input.phase}, ${input.producer}, ${invocationId})
        `;
        }).pipe(Effect.asVoid),
      getReviewerSession: (changeId, producer) =>
        repository.transaction("read legacy Reviewer Session", (sql) =>
          Effect.flatMap(
            sql<StoredReviewerSessionRow>`
            SELECT change_id AS changeId, producer, fingerprint,
              session_reference AS sessionReference
            FROM reviewer_sessions
            WHERE change_id = ${changeId} AND producer = ${producer}
          `,
            (rows) => {
              const row = rows[0];
              return row === undefined
                ? Effect.succeed(undefined)
                : decodePersisted("read legacy Reviewer Session", () =>
                    decodeReviewerSession(row, changeId),
                  );
            },
          ),
        ),
    }),
  );

const changeAgentConfigurationCanBeCorrected = (
  sql: SqlClient.SqlClient,
  sessionId: number,
  invocationId: number,
) =>
  Effect.gen(function* () {
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
        AND invocation.id <> ${invocationId}
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
        AND invocation.id <> ${invocationId}
        AND invocation.settlement_kind = 'returned'
    `;
    return (
      latest[0]?.settlementKind === "launch_failed" &&
      latest[0]?.transcriptPath === null &&
      (transcript[0]?.count ?? 0) === 0 &&
      (returned[0]?.count ?? 0) === 0
    );
  });

const replaceChangeRoleConfiguration = (
  configuration: ChangeReviewerConfiguration,
  producer: string,
  replacement: unknown,
): ChangeReviewerConfiguration => {
  if (producer === "acceptance") {
    return {
      ...configuration,
      acceptanceReview: replacement as ChangeReviewerConfiguration["acceptanceReview"],
    };
  }
  const index = configuration.specialistReviews.findIndex((policy) => policy.id === producer);
  if (index < 0) throw new Error(`Change reviewer roster does not contain producer ${producer}`);
  return {
    ...configuration,
    specialistReviews: configuration.specialistReviews.map((policy, policyIndex) =>
      policyIndex === index ? (replacement as typeof policy) : policy,
    ),
  };
};
