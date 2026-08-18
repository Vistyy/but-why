import { Effect } from "effect";

import { internalChangeId } from "../change/changeId.js";
import type { ChangeAgentSessionPort } from "../change/changePorts.js";
import {
  type ChangeReviewerPolicy,
  decodeChangeReviewerConfiguration,
  decodeSqliteChangeReviewerConfiguration,
  sameChangeReviewerPolicy,
} from "../change/changeReviewerConfiguration.js";
import type { ChangeReviewerConfiguration } from "../change/changeStartStore.js";
import { validationPhase } from "../change/validationRun/validationRun.js";
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
          const operationName = "link Change Agent Invocation";
          yield* requireValidationPosition(sql, {
            validationRunId: input.validationRunId,
            phase: input.phase,
            producer: input.producer,
            operationName,
            idPrefix: repository.idPrefix,
            active: true,
          });
          const existingResults = yield* sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count
            FROM validation_phase_results
            WHERE validation_run_id = ${input.validationRunId}
              AND phase = ${input.phase}
              AND producer = ${input.producer}
          `;
          if ((existingResults[0]?.count ?? 0) > 0) {
            return yield* invalid(
              operationName,
              "A reviewer Invocation cannot be linked after its final Phase Result",
            );
          }
          const owners = yield* sql<{
            readonly changeId: number;
            readonly closeReason: string | null;
            readonly reviewerConfiguration: string;
          }>`
            SELECT candidate.change_id AS changeId, change_row.close_reason AS closeReason,
              change_row.reviewer_configuration AS reviewerConfiguration
            FROM validation_runs AS run
            JOIN candidates AS candidate ON candidate.id = run.candidate_id
            JOIN changes AS change_row ON change_row.id = candidate.change_id
            WHERE run.id = ${input.validationRunId}
          `;
          const expectedChangeId = internalChangeId(input.changeId, repository.idPrefix);
          const owner = owners[0];
          if (owner?.changeId !== expectedChangeId || owner.closeReason !== null) {
            return yield* invalid(
              "link Change Agent Invocation",
              "Validation position does not belong to the open Change",
            );
          }
          const reviewerEvidence = yield* Effect.try({
            try: () => {
              const configuration = decodeSqliteChangeReviewerConfiguration(
                owner.reviewerConfiguration,
              );
              const stored = changeReviewerPolicy(configuration, input.phase, input.producer);
              const snapshot = decodeReviewerPolicySnapshot(
                input.configurationSnapshot,
                input.phase,
                input.producer,
              );
              return { configuration, stored, snapshot };
            },
            catch: (cause) => new RepositoryPersistedDataInvalid({ operationName, cause }),
          });
          const sessions = yield* sql<{
            readonly agentSessionId: number;
            readonly harness: string;
            readonly provider: string | null;
            readonly model: string;
            readonly thinking: string | null;
          }>`
            SELECT continuation.agent_session_id AS agentSessionId, continuation.harness,
              continuation.provider, continuation.model, continuation.thinking
            FROM agent_invocations AS invocation
            JOIN agent_continuations AS continuation ON continuation.id = invocation.continuation_id
            WHERE invocation.id = ${invocationId}
          `;
          const session = sessions[0];
          if (session === undefined) {
            return yield* invalid(operationName, "Invocation Session is missing");
          }
          const sessionId = session.agentSessionId;
          const runtimeConfig = reviewerEvidence.snapshot.profile.profile.runtimeConfig;
          if (
            session.harness !== "pi" ||
            session.provider !== null ||
            session.model !== runtimeConfig.model ||
            session.thinking !== (runtimeConfig.thinking ?? null)
          ) {
            return yield* invalid(
              operationName,
              "Agent Continuation configuration does not match the Validation reviewer",
            );
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
          if (
            !sameChangeReviewerPolicy(
              input.producer,
              reviewerEvidence.stored,
              reviewerEvidence.snapshot,
            )
          ) {
            return yield* invalid(
              operationName,
              "Validation reviewer configuration does not match the frozen Change policy",
            );
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

const invalid = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));

const changeReviewerPolicy = (
  configuration: ChangeReviewerConfiguration,
  phase: string,
  producer: string,
): ChangeReviewerPolicy => {
  if (phase === validationPhase.acceptanceReview && producer === "acceptance") {
    if (configuration.acceptanceReview === null) {
      throw new Error("Change reviewer roster does not contain the Acceptance Reviewer");
    }
    return configuration.acceptanceReview;
  }
  if (phase === validationPhase.specialistReview) {
    const specialist = configuration.specialistReviews.find((review) => review.id === producer);
    if (specialist !== undefined) return specialist;
  }
  throw new Error("Validation position is not a Change reviewer role");
};

const decodeReviewerPolicySnapshot = (
  snapshot: unknown,
  phase: string,
  producer: string,
): ChangeReviewerPolicy => {
  if (phase === validationPhase.acceptanceReview && producer === "acceptance") {
    const policy = decodeChangeReviewerConfiguration({
      acceptanceReview: snapshot,
      specialistReviews: [],
    }).acceptanceReview;
    if (policy === null) throw new Error("Acceptance Reviewer Snapshot is missing");
    return policy;
  }
  if (phase === validationPhase.specialistReview) {
    const policies = decodeChangeReviewerConfiguration({
      acceptanceReview: null,
      specialistReviews: [snapshot],
    }).specialistReviews;
    const policy = policies[0];
    if (policy?.id === producer) return policy;
    throw new Error("Specialist Reviewer Snapshot does not match its producer");
  }
  throw new Error("Validation position is not a reviewer role");
};
