import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import type { CandidateValidationRunAbandonmentContext } from "../change/candidateValidation/candidateValidationRunStore.js";
import type { ValidationRunAbandonmentPort } from "../change/validation/changeValidationPorts.js";
import { RepositorySql } from "./repositorySql.js";
import { settleUnsettledAgentInvocations } from "./sqliteAgentSessionPersistence.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";
import { readValidationRunById } from "./sqliteValidationRunStorage.js";

export const openSqliteValidationRunAbandonmentPort = () =>
  Effect.map(
    RepositorySql,
    (repository): ValidationRunAbandonmentPort => ({
      getAbandonmentContext: (validationRunId) =>
        repository.transaction("read Candidate Validation Run abandonment context", (sql) =>
          getAbandonmentContext(sql, validationRunId),
        ),
      getRunById: (validationRunId) =>
        repository.transaction("read Candidate Validation Run", (sql) =>
          readValidationRunById(sql, validationRunId, "decode Candidate Validation Run"),
        ),
      recordToolingFailure: (input) =>
        repository.operation("record Candidate validation Tooling Failure", (sql) =>
          Effect.asVoid(sql`
            INSERT INTO candidate_validation_tooling_failures (
              validation_run_id, error_kind, operation_name, error_message, created_at
            ) VALUES (
              ${input.validationRunId}, ${input.errorKind}, ${input.operationName},
              ${input.errorMessage}, ${input.now}
            )
          `),
        ),
      abandon: (input) =>
        repository.transactionImmediate("abandon Candidate Validation Run", (sql) =>
          abandon(sql, input),
        ),
    }),
  );

type StoredAbandonmentContextRow = {
  readonly validationRunId: string;
  readonly runCandidateId: string;
  readonly changeId: string;
  readonly storedChangeId: string;
  readonly candidateId: string;
  readonly submittedSha: string;
  readonly setupValidationRunId: string | null;
  readonly setupExpectedCommitSha: string | null;
  readonly worktreePath: string | null;
  readonly cleanupWorkspace: CandidateValidationRunAbandonmentContext["cleanupWorkspace"];
};

const getAbandonmentContext = (sql: SqlClient.SqlClient, validationRunId: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<StoredAbandonmentContextRow>`
      SELECT run.id AS validationRunId, run.candidate_id AS runCandidateId,
        candidate.change_id AS changeId, change_row.id AS storedChangeId,
        candidate.id AS candidateId, candidate.head_sha AS submittedSha,
        setup.validation_run_id AS setupValidationRunId,
        setup.expected_commit_sha AS setupExpectedCommitSha,
        setup.workspace_path AS worktreePath, setup.cleanup_workspace AS cleanupWorkspace
      FROM candidate_validation_runs AS run
      LEFT JOIN candidates AS candidate ON candidate.id = run.candidate_id
      LEFT JOIN changes AS change_row ON change_row.id = candidate.change_id
      LEFT JOIN candidate_snapshot_workspaces AS setup ON setup.validation_run_id = run.id
      WHERE run.id = ${validationRunId}
    `;
    const row = rows[0];
    return row === undefined
      ? undefined
      : yield* decodePersisted("read Candidate Validation Run abandonment context", () =>
          decodeAbandonmentContext(row, validationRunId),
        );
  });

const abandon = (
  sql: SqlClient.SqlClient,
  input: {
    readonly validationRunId: string;
    readonly errorKind: string;
    readonly operationName: string;
    readonly errorMessage: string;
    readonly now: string;
  },
) =>
  Effect.gen(function* () {
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
      UPDATE candidate_snapshot_workspaces
      SET cleanup_workspace = 'removed'
      WHERE validation_run_id = ${input.validationRunId}
    `;
    yield* sql`
      INSERT INTO candidate_validation_tooling_failures (
        validation_run_id, error_kind, operation_name, error_message, created_at
      ) VALUES (
        ${input.validationRunId}, ${input.errorKind}, ${input.operationName},
        ${input.errorMessage}, ${input.now}
      )
    `;
    yield* complete(sql, {
      validationRunId: input.validationRunId,
      outcome: "tooling_failed",
      now: input.now,
    });
  }).pipe(Effect.asVoid);

const complete = (
  sql: SqlClient.SqlClient,
  input: { readonly validationRunId: string; readonly outcome: string; readonly now: string },
) =>
  Effect.zipRight(
    sql`
      UPDATE candidate_validation_runs
      SET state = 'complete', outcome = ${input.outcome}, updated_at = ${input.now}
      WHERE id = ${input.validationRunId}
    `,
    sql`DELETE FROM active_validation_runs WHERE validation_run_id = ${input.validationRunId}`,
  ).pipe(Effect.asVoid);

const decodeAbandonmentContext = (
  row: StoredAbandonmentContextRow,
  expectedValidationRunId: string,
): CandidateValidationRunAbandonmentContext => {
  if (row.validationRunId !== expectedValidationRunId || row.runCandidateId !== row.candidateId) {
    throw new Error("Validation Run abandonment relationship is inconsistent");
  }
  if (row.changeId !== row.storedChangeId) {
    throw new Error("Validation Run Candidate belongs to an unknown Change");
  }
  if (
    row.setupValidationRunId !== null &&
    (row.setupValidationRunId !== row.validationRunId ||
      row.setupExpectedCommitSha !== row.submittedSha)
  ) {
    throw new Error("Snapshot Workspace Setup relationship is inconsistent");
  }
  if (row.setupValidationRunId === null && row.cleanupWorkspace !== null) {
    throw new Error("Validation Run cleanup state has no Snapshot Workspace Setup");
  }
  if (
    row.setupValidationRunId !== null &&
    (row.worktreePath === null || row.cleanupWorkspace === null)
  ) {
    throw new Error("Snapshot Workspace Setup is incomplete");
  }
  return {
    validationRunId: row.validationRunId,
    changeId: row.changeId,
    candidateId: row.candidateId,
    submittedSha: row.submittedSha,
    ...(row.worktreePath === null ? {} : { worktreePath: row.worktreePath }),
    cleanupWorkspace: row.cleanupWorkspace,
  };
};
