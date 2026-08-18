import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import { internalChangeId } from "../change/changeId.js";
import type { ChangeAgentSessionPort } from "../change/changePorts.js";
import {
  decodeChangeReviewerConfiguration,
  encodeSqliteChangeReviewerConfiguration,
} from "../change/changeReviewerConfiguration.js";
import type { ChangeReviewerConfiguration } from "../change/changeStartStore.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { RepositorySql } from "./repositorySql.js";
import { requireValidationPosition } from "./sqliteValidationPosition.js";

export const openSqliteChangeAgentSessionPort = () =>
  Effect.map(
    RepositorySql,
    (repository): ChangeAgentSessionPort => ({
      getAgentSession: (changeId, producer) =>
        repository.transaction("read Change Agent Session", (sql) =>
          Effect.map(
            sql<{ readonly agentSessionId: number }>`
            SELECT agent_session_id AS agentSessionId
            FROM change_agent_sessions
            WHERE change_id = ${internalChangeId(changeId, repository.idPrefix)} AND producer = ${producer}
          `,
            (rows) => rows[0]?.agentSessionId ?? undefined,
          ),
        ),
      linkAgentInvocation: (input) => (sql, invocationId) =>
        Effect.gen(function* () {
          yield* requireValidationPosition(sql, {
            validationRunId: input.validationRunId,
            phase: input.phase,
            producer: input.producer,
            operationName: "link Change Agent Invocation",
            idPrefix: repository.idPrefix,
            active: true,
          });
          const owners = yield* sql<{
            readonly changeId: number;
            readonly closeReason: string | null;
          }>`
            SELECT candidate.change_id AS changeId, change_row.close_reason AS closeReason
            FROM validation_runs AS run
            JOIN candidates AS candidate ON candidate.id = run.candidate_id
            JOIN changes AS change_row ON change_row.id = candidate.change_id
            WHERE run.id = ${input.validationRunId}
          `;
          const expectedChangeId = internalChangeId(input.changeId, repository.idPrefix);
          if (owners[0]?.changeId !== expectedChangeId || owners[0].closeReason !== null) {
            return yield* invalid(
              "link Change Agent Invocation",
              "Validation position does not belong to the open Change",
            );
          }
          const sessions = yield* sql<{ readonly agentSessionId: number }>`
          SELECT continuation.agent_session_id AS agentSessionId
          FROM agent_invocations AS invocation
          JOIN agent_continuations AS continuation ON continuation.id = invocation.continuation_id
          WHERE invocation.id = ${invocationId}
        `;
          const sessionId = sessions[0]?.agentSessionId;
          if (sessionId === undefined) {
            return yield* invalid("link Change Agent Invocation", "Invocation Session is missing");
          }
          const taskOwners = yield* sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count FROM tasks WHERE reviewer_agent_session_id = ${sessionId}
          `;
          const otherChangeOwners = yield* sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count FROM change_agent_sessions
            WHERE agent_session_id = ${sessionId} AND change_id <> ${expectedChangeId}
          `;
          if ((taskOwners[0]?.count ?? 0) > 0 || (otherChangeOwners[0]?.count ?? 0) > 0) {
            return yield* invalid(
              "link Change Agent Invocation",
              "Agent Session already has another owner",
            );
          }
          const existingOwners = yield* sql<{ readonly agentSessionId: number }>`
            SELECT agent_session_id AS agentSessionId
            FROM change_agent_sessions
            WHERE change_id = ${expectedChangeId} AND producer = ${input.producer}
          `;
          if (existingOwners[0] !== undefined && existingOwners[0].agentSessionId !== sessionId) {
            return yield* invalid(
              "link Change Agent Invocation",
              "Change role already has another Agent Session",
            );
          }
          const canCorrect =
            input.configurationSnapshot === undefined
              ? false
              : yield* changeAgentConfigurationCanBeCorrected(sql, sessionId, invocationId);
          if (canCorrect) {
            const configurations = yield* sql<{ readonly configuration: string | null }>`
              SELECT reviewer_configuration AS configuration FROM changes WHERE id = ${internalChangeId(input.changeId, repository.idPrefix)}
            `;
            const configuration = configurations[0]?.configuration;
            if (configuration !== undefined && configuration !== null) {
              const replacement = yield* Effect.try({
                try: () => {
                  return replaceChangeRoleConfiguration(
                    decodeChangeReviewerConfiguration(JSON.parse(configuration) as unknown),
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
                UPDATE changes SET reviewer_configuration = ${encodeSqliteChangeReviewerConfiguration(replacement)}
                WHERE id = ${internalChangeId(input.changeId, repository.idPrefix)}
              `;
            }
          }
          yield* sql`
          INSERT INTO change_agent_sessions (change_id, producer, agent_session_id)
          VALUES (${expectedChangeId}, ${input.producer}, ${sessionId})
          ON CONFLICT(change_id, producer) DO NOTHING
        `;
          yield* sql`
          INSERT INTO validation_phase_agent_invocations (
            validation_run_id, phase, producer, agent_invocation_id
          ) VALUES (${input.validationRunId}, ${input.phase}, ${input.producer}, ${invocationId})
        `;
        }).pipe(Effect.asVoid),
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

const invalid = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));

const replaceChangeRoleConfiguration = (
  configuration: ChangeReviewerConfiguration,
  producer: string,
  replacement: unknown,
): ChangeReviewerConfiguration => {
  if (producer === "acceptance") {
    return decodeChangeReviewerConfiguration({
      ...configuration,
      acceptanceReview: replacement,
    });
  }
  const index = configuration.specialistReviews.findIndex((policy) => policy.id === producer);
  if (index < 0) throw new Error(`Change reviewer roster does not contain producer ${producer}`);
  return decodeChangeReviewerConfiguration({
    ...configuration,
    specialistReviews: configuration.specialistReviews.map((policy, policyIndex) =>
      policyIndex === index ? replacement : policy,
    ),
  });
};
