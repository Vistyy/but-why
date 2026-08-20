import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import { assertValidationToolingFailureEvidence } from "../change/candidateValidation/candidateValidationEvidence.js";
import type { CandidateValidationRunAbandonmentContext } from "../change/candidateValidation/candidateValidationRunStore.js";
import { publicChangeId } from "../change/changeId.js";
import type { ValidationRunAbandonmentPort } from "../change/validation/changeValidationPorts.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { RepositorySql } from "../repositoryRuntime/adapters/sqlite/repositorySql.js";
import { decodePersisted } from "../repositoryRuntime/adapters/sqlite/sqlitePersistedData.js";
import { settleUnsettledAgentInvocations } from "./sqliteAgentSessionPersistence.js";
import { readValidationRunById } from "./sqliteValidationRunStorage.js";

export const openSqliteValidationRunAbandonmentPort = () =>
  Effect.map(
    RepositorySql,
    (repository): ValidationRunAbandonmentPort => ({
      getAbandonmentContext: (validationRunId) =>
        repository.transaction("read Candidate Validation Run abandonment context", (sql) =>
          getAbandonmentContext(sql, validationRunId, repository.idPrefix),
        ),
      getRunById: (validationRunId) =>
        repository.transaction("read Candidate Validation Run", (sql) =>
          readValidationRunById(
            sql,
            validationRunId,
            "decode Candidate Validation Run",
            repository.idPrefix,
          ),
        ),
      recordWorkspaceCleanup: (input) =>
        repository.transactionImmediate("record Candidate Snapshot Workspace cleanup", (sql) =>
          recordWorkspaceCleanup(
            sql,
            input.validationRunId,
            input.cleanupWorkspace,
            input.cleanupBlockingReason,
          ),
        ),
      recordToolingFailure: (input) =>
        repository.transactionImmediate("record Candidate validation Tooling Failure", (sql) =>
          Effect.gen(function* () {
            const operationName = "record Candidate validation Tooling Failure";
            const failure = toolingFailureValue(input);
            yield* requireValidToolingFailure(failure, operationName);
            yield* sql`
              UPDATE validation_runs
              SET run_tooling_failure = ${JSON.stringify(failure)}
              WHERE id = ${input.validationRunId} AND outcome IS NULL
            `;
          }).pipe(Effect.asVoid),
        ),
      abandon: (input) =>
        repository.transactionImmediate("abandon Candidate Validation Run", (sql) =>
          abandon(sql, input),
        ),
    }),
  );

type StoredAbandonmentContextRow = {
  readonly validationRunId: number;
  readonly runCandidateId: number;
  readonly changeId: number;
  readonly storedChangeId: number;
  readonly candidateId: number;
  readonly submittedSha: string;
};

const getAbandonmentContext = (
  sql: SqlClient.SqlClient,
  validationRunId: number,
  idPrefix: string,
) =>
  Effect.flatMap(
    sql<StoredAbandonmentContextRow>`
      SELECT run.id AS validationRunId, run.candidate_id AS runCandidateId,
        candidate.change_id AS changeId, change_row.id AS storedChangeId,
        candidate.id AS candidateId, candidate.head_commit AS submittedSha
      FROM validation_runs AS run
      LEFT JOIN candidates AS candidate ON candidate.id = run.candidate_id
      LEFT JOIN changes AS change_row ON change_row.id = candidate.change_id
      WHERE run.id = ${validationRunId}
    `,
    (rows) =>
      rows[0] === undefined
        ? Effect.succeed(undefined)
        : decodePersisted("read Candidate Validation Run abandonment context", () =>
            decodeAbandonmentContext(
              rows[0] as StoredAbandonmentContextRow,
              validationRunId,
              idPrefix,
            ),
          ),
  );

const recordWorkspaceCleanup = (
  sql: SqlClient.SqlClient,
  validationRunId: number,
  cleanupWorkspace: "removed" | "not_created" | "failed",
  cleanupBlockingReason?: string,
) =>
  Effect.gen(function* () {
    const reason =
      cleanupWorkspace === "failed"
        ? (cleanupBlockingReason ?? "Snapshot Workspace cleanup failed.")
        : null;
    yield* sql`
      UPDATE validation_runs
      SET cleanup_pending = ${cleanupWorkspace === "failed" ? 1 : 0},
        cleanup_blocking_reason = ${reason}
      WHERE id = ${validationRunId} AND outcome IS NULL
    `;
  }).pipe(Effect.asVoid);

const abandon = (
  sql: SqlClient.SqlClient,
  input: {
    readonly validationRunId: number;
    readonly errorKind: string;
    readonly operationName: string;
    readonly errorMessage: string;
    readonly now: string;
  },
) =>
  Effect.gen(function* () {
    const failure = toolingFailureValue(input);
    yield* requireValidToolingFailure(failure, "abandon Candidate Validation Run");
    const linked = yield* sql<{ readonly invocationId: number }>`
      SELECT agent_invocation_id AS invocationId
      FROM validation_phase_agent_invocations
      WHERE validation_run_id = ${input.validationRunId}
    `;
    yield* settleUnsettledAgentInvocations(
      sql,
      linked.map(({ invocationId }) => invocationId),
      input.now,
      `Validation Run abandonment confirmed that the reviewer process stopped. ${input.errorMessage}`,
    );
    yield* sql`
      UPDATE validation_runs
      SET cleanup_pending = 0, cleanup_blocking_reason = NULL,
        run_tooling_failure = ${JSON.stringify(failure)},
        outcome = 'tooling_failed'
      WHERE id = ${input.validationRunId} AND outcome IS NULL
    `;
  }).pipe(Effect.asVoid);

const decodeAbandonmentContext = (
  row: StoredAbandonmentContextRow,
  expectedValidationRunId: number,
  idPrefix: string,
): CandidateValidationRunAbandonmentContext => {
  if (row.validationRunId !== expectedValidationRunId || row.runCandidateId !== row.candidateId) {
    throw new Error("Validation Run abandonment relationship is inconsistent");
  }
  if (row.changeId !== row.storedChangeId) {
    throw new Error("Validation Run Candidate belongs to an unknown Change");
  }
  return {
    validationRunId: row.validationRunId,
    changeId: publicChangeId(idPrefix, row.changeId),
    candidateId: row.candidateId,
    submittedSha: row.submittedSha,
  };
};

const requireValidToolingFailure = (
  failure: Parameters<typeof assertValidationToolingFailureEvidence>[0],
  operationName: string,
) =>
  Effect.try({
    try: () => assertValidationToolingFailureEvidence(failure),
    catch: (cause) => new RepositoryPersistedDataInvalid({ operationName, cause }),
  });

const toolingFailureValue = (input: {
  readonly errorKind: string;
  readonly operationName: string;
  readonly errorMessage: string;
  readonly blockingInvocationId?: number;
}) => ({
  errorKind: input.errorKind,
  operationName: input.operationName,
  errorMessage: input.errorMessage,
  ...(input.blockingInvocationId === undefined
    ? {}
    : { blockingInvocationId: input.blockingInvocationId }),
});
