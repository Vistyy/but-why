import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import type { CandidateRecord } from "../change/candidate/candidate.js";

import type { ValidationRunAbandonmentPort } from "../change/validation/changeValidationPorts.js";

import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { RepositorySql } from "./repositorySql.js";

import {
  candidateReadColumns,
  decodeAbandonmentContext,
  decodeCandidate,
  decodeValidationRun,
  type StoredAbandonmentContextRow,
  type StoredCandidateRow,
  type StoredValidationRunRow,
  validateValidationRunImplementationDecisionRelationships,
  validateValidationRunLatestResolvedBlockerRelationship,
  validationRunReadColumns,
} from "./sqliteCandidateValidationReadModel.js";
import {
  decodeImplementationBlockerHistory,
  implementationBlockerReadColumns,
  latestResolvedBlockerId,
  type StoredImplementationBlockerRow,
} from "./sqliteChangeReadModel.js";

import { decodePersisted } from "./sqliteTaskReadModel.js";

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
          getRunById(sql, validationRunId),
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

type CandidateOwnerRow = StoredCandidateRow & { readonly storedChangeId: string | null };

const decodeOwnedCandidate = (
  row: CandidateOwnerRow,
  expectedChangeId?: string,
): CandidateRecord => {
  const candidate = decodeCandidate(row);
  const storedChangeId = row.storedChangeId;
  if (
    candidate.changeId !== storedChangeId ||
    (expectedChangeId !== undefined && candidate.changeId !== expectedChangeId)
  ) {
    throw new Error("Candidate belongs to another or unknown Change");
  }
  return candidate;
};

const readCandidateById = (sql: SqlClient.SqlClient, candidateId: string, operationName: string) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<CandidateOwnerRow>(
      `SELECT ${candidateReadColumns}, change_row.id AS storedChangeId
       FROM candidates AS candidate
       LEFT JOIN changes AS change_row ON change_row.id = candidate.change_id
       WHERE candidate.id = ?`,
      [candidateId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    return yield* decodePersisted(operationName, () => {
      const candidate = decodeOwnedCandidate(row);
      if (candidate.id !== candidateId) throw new Error("Candidate identity does not match lookup");
      return candidate;
    });
  });

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

const getRunById = (sql: SqlClient.SqlClient, validationRunId: string) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<StoredValidationRunRow>(
      `SELECT ${validationRunReadColumns}
       FROM candidate_validation_runs WHERE id = ?`,
      [validationRunId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    const decoded = yield* decodePersisted("decode Candidate Validation Run", () => {
      const run = decodeValidationRun(row);
      if (run.record.id !== validationRunId)
        throw new Error("Validation Run identity does not match lookup");
      return run;
    });
    const candidate = yield* readCandidateById(
      sql,
      decoded.record.candidateId,
      "decode Candidate Validation Run",
    );
    if (candidate === undefined) {
      return yield* invalidData(
        "decode Candidate Validation Run",
        "Validation Run belongs to an unknown Candidate",
      );
    }
    yield* validateSelectedValidationRunAuthority(
      sql,
      decoded,
      candidate.changeId,
      "decode Candidate Validation Run",
    );
    return decoded.record;
  });

const validateSelectedValidationRunAuthority = (
  sql: SqlClient.SqlClient,
  run: ReturnType<typeof decodeValidationRun>,
  changeId: string,
  operationName: string,
) =>
  Effect.gen(function* () {
    const latestRows = yield* sql.unsafe<StoredImplementationBlockerRow>(
      `SELECT ${implementationBlockerReadColumns}
       FROM implementation_blockers
       WHERE change_id = ? AND resolved_at IS NOT NULL AND resolved_at <= ?
       ORDER BY resolved_at DESC, sequence DESC LIMIT 1`,
      [changeId, run.record.createdAt],
    );
    const latestBlockerId = yield* decodePersisted(operationName, () =>
      latestResolvedBlockerId(decodeImplementationBlockerHistory(latestRows, changeId)),
    );
    yield* decodePersisted(operationName, () => {
      validateValidationRunImplementationDecisionRelationships(run, changeId);
      validateValidationRunLatestResolvedBlockerRelationship(run, latestBlockerId);
    });
  });

const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
