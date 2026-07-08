import type { DatabaseSync } from "node:sqlite";

import { rollbackIfOpen, withStateDatabase, type SqliteStoreInput } from "./connection.js";
import { decodeSqliteJsonStringArray } from "./sqliteJsonStringArray.js";
import { queryAll, queryOne } from "./query.js";
import {
  recordValidationRunToolingErrorMutation,
  validationRunExists,
} from "./sqliteValidationRunInternals.js";
import type {
  ValidationRunArtifactRecord,
  ValidationRunFindingRecord,
  ValidationRunPhaseStatusRecord,
  ValidationRunRecord,
  ValidationRunRoundRecord,
} from "../validationRun/validationRun.js";
import type {
  RecordValidationRunErrorInput,
  RecordValidationRunErrorResult,
  RecordValidationRunToolingErrorInput,
  RecordValidationWorkspaceSetupInput,
  ValidationRunStore,
  ValidationRunSummaryRecord,
  ValidationRunToolingErrorRecord,
  ValidationWorkspaceSetupRecord,
} from "../validationRun/validationRunStore.js";

const validationRunRecordColumns = [
  "id",
  "task_id AS taskId",
  "task_validation_number AS taskValidationNumber",
  "status",
  "branch",
  "commit_sha AS commitSha",
  "github_owner AS githubOwner",
  "github_repo AS githubRepo",
  "github_base_branch AS githubBaseBranch",
  "github_remote_name AS githubRemoteName",
  "github_remote_url AS githubRemoteUrl",
  "created_at AS createdAt",
  "updated_at AS updatedAt",
].join(", ");
const validationWorkspaceSetupColumns = [
  "validation_run_id AS validationRunId",
  "temp_ref_name AS tempRefName",
  "submitted_sha AS submittedSha",
  "worktree_head AS worktreeHead",
  "cleanup_worktree AS cleanupWorktree",
  "cleanup_temp_ref AS cleanupTempRef",
  "created_at AS createdAt",
].join(", ");
const validationRunToolingErrorColumns = [
  "sequence",
  "validation_run_id AS validationRunId",
  "error_kind AS errorKind",
  "operation_name AS operationName",
  "temp_ref_name AS tempRefName",
  "submitted_sha AS submittedSha",
  "worktree_path AS worktreePath",
  "error_message AS errorMessage",
  "cleanup_worktree AS cleanupWorktree",
  "cleanup_temp_ref AS cleanupTempRef",
  "created_at AS createdAt",
].join(", ");
const validationRunPhaseStatusColumns = [
  "validation_run_id AS validationRunId",
  "phase",
  "status",
  "error_message AS errorMessage",
  "created_at AS createdAt",
  "updated_at AS updatedAt",
].join(", ");
const validationRunRoundColumns = [
  "validation_run_id AS validationRunId",
  "phase",
  "round_number AS roundNumber",
  "status",
  "created_at AS createdAt",
  "updated_at AS updatedAt",
].join(", ");
const validationRunFindingColumns = [
  "id",
  "validation_run_id AS validationRunId",
  "phase",
  "producer",
  "title",
  "description",
  "severity",
  "evidence",
  "files",
  "artifact_refs AS artifactRefs",
  "created_at AS createdAt",
  "updated_at AS updatedAt",
].join(", ");
const validationRunArtifactColumns = [
  "ref",
  "validation_run_id AS validationRunId",
  "phase",
  "producer",
  "path",
  "created_at AS createdAt",
].join(", ");
const validationPhaseOrderSql = `
  CASE phase
    WHEN 'preflight' THEN 1
    WHEN 'checks' THEN 2
    WHEN 'intent_review' THEN 3
    WHEN 'quality_review' THEN 4
    WHEN 'publish_pr' THEN 5
    WHEN 'watch_pr' THEN 6
  END
`;

export const openSqliteValidationRunStore = (input: SqliteStoreInput): ValidationRunStore => ({
  getValidationRunById: (validationRunId) =>
    withStateDatabase(input, (database) => getValidationRunById(database, validationRunId)),
  getLatestValidationRunIdForTask: (taskId) =>
    withStateDatabase(input, (database) => getLatestValidationRunIdForTask(database, taskId)),
  listValidationRunSummariesForTask: (taskId) =>
    withStateDatabase(input, (database) => listValidationRunSummariesForTask(database, taskId)),
  getValidationWorkspaceSetup: (validationRunId) =>
    withStateDatabase(input, (database) => getValidationWorkspaceSetup(database, validationRunId)),
  listValidationRunToolingErrors: (validationRunId) =>
    withStateDatabase(input, (database) =>
      listValidationRunToolingErrors(database, validationRunId),
    ),
  listValidationRunPhaseStatuses: (validationRunId) =>
    withStateDatabase(input, (database) =>
      listValidationRunPhaseStatuses(database, validationRunId),
    ),
  listValidationRunRounds: (validationRunId) =>
    withStateDatabase(input, (database) => listValidationRunRounds(database, validationRunId)),
  listValidationRunFindings: (validationRunId) =>
    withStateDatabase(input, (database) => listValidationRunFindings(database, validationRunId)),
  listValidationRunArtifacts: (validationRunId) =>
    withStateDatabase(input, (database) => listValidationRunArtifacts(database, validationRunId)),
  recordValidationRunError: (validationRunInput) =>
    withStateDatabase(input, (database) => recordValidationRunError(database, validationRunInput)),
  recordValidationWorkspaceSetup: (validationRunInput) =>
    withStateDatabase(input, (database) =>
      recordValidationWorkspaceSetup(database, validationRunInput),
    ),
  recordValidationRunToolingError: (validationRunInput) =>
    withStateDatabase(input, (database) =>
      recordValidationRunToolingError(database, validationRunInput),
    ),
});

const getValidationRunById = (
  database: DatabaseSync,
  validationRunId: string,
): ValidationRunRecord | undefined => {
  const row = queryOne<ValidationRunRecordRow>(
    database,
    `
      SELECT ${validationRunRecordColumns}
      FROM validation_runs
      WHERE id = ?
    `,
    [validationRunId],
  );

  if (row === undefined) {
    return undefined;
  }

  return rowToValidationRunRecord(row);
};

const getLatestValidationRunIdForTask = (database: DatabaseSync, taskId: string): string | null => {
  const row = queryOne<ValidationRunIdRow>(
    database,
    "SELECT id FROM validation_runs WHERE task_id = ? ORDER BY task_validation_number DESC LIMIT 1",
    [taskId],
  );

  return row?.id ?? null;
};

const listValidationRunSummariesForTask = (
  database: DatabaseSync,
  taskId: string,
): readonly ValidationRunSummaryRecord[] =>
  queryAll<ValidationRunSummaryRow>(
    database,
    `
      SELECT
        id,
        task_validation_number AS taskValidationNumber,
        status,
        branch,
        commit_sha AS commitSha,
        created_at AS createdAt,
        updated_at AS updatedAt,
        (
          SELECT COUNT(*)
          FROM validation_run_findings
          WHERE validation_run_findings.validation_run_id = validation_runs.id
        ) AS findingCount,
        (
          SELECT COUNT(*)
          FROM validation_run_tooling_errors
          WHERE validation_run_tooling_errors.validation_run_id = validation_runs.id
        ) AS toolingFailureCount
      FROM validation_runs
      WHERE task_id = ?
      ORDER BY task_validation_number DESC
    `,
    [taskId],
  ).map(rowToValidationRunSummary);

const getValidationWorkspaceSetup = (
  database: DatabaseSync,
  validationRunId: string,
): ValidationWorkspaceSetupRecord | undefined => {
  const row = queryOne<ValidationWorkspaceSetupRow>(
    database,
    `
      SELECT ${validationWorkspaceSetupColumns}
      FROM validation_workspace_setups
      WHERE validation_run_id = ?
    `,
    [validationRunId],
  );

  if (row === undefined) {
    return undefined;
  }

  return rowToValidationWorkspaceSetup(row);
};

const listValidationRunToolingErrors = (
  database: DatabaseSync,
  validationRunId: string,
): readonly ValidationRunToolingErrorRecord[] =>
  queryAll<ValidationRunToolingErrorRow>(
    database,
    `
      SELECT ${validationRunToolingErrorColumns}
      FROM validation_run_tooling_errors
      WHERE validation_run_id = ?
      ORDER BY sequence ASC
    `,
    [validationRunId],
  ).map(rowToValidationRunToolingError);

const listValidationRunPhaseStatuses = (
  database: DatabaseSync,
  validationRunId: string,
): readonly ValidationRunPhaseStatusRecord[] =>
  queryAll<ValidationRunPhaseStatusRow>(
    database,
    `
      SELECT ${validationRunPhaseStatusColumns}
      FROM validation_run_phase_statuses
      WHERE validation_run_id = ?
      ORDER BY ${validationPhaseOrderSql}
    `,
    [validationRunId],
  ).map(rowToValidationRunPhaseStatus);

const listValidationRunRounds = (
  database: DatabaseSync,
  validationRunId: string,
): readonly ValidationRunRoundRecord[] =>
  queryAll<ValidationRunRoundRow>(
    database,
    `
      SELECT ${validationRunRoundColumns}
      FROM validation_run_rounds
      WHERE validation_run_id = ?
      ORDER BY phase ASC, round_number ASC
    `,
    [validationRunId],
  ).map(rowToValidationRunRound);

const listValidationRunFindings = (
  database: DatabaseSync,
  validationRunId: string,
): readonly ValidationRunFindingRecord[] =>
  queryAll<ValidationRunFindingRow>(
    database,
    `
      SELECT ${validationRunFindingColumns}
      FROM validation_run_findings
      WHERE validation_run_id = ?
      ORDER BY id ASC
    `,
    [validationRunId],
  ).map(rowToValidationRunFinding);

const listValidationRunArtifacts = (
  database: DatabaseSync,
  validationRunId: string,
): readonly ValidationRunArtifactRecord[] =>
  queryAll<ValidationRunArtifactRow>(
    database,
    `
      SELECT ${validationRunArtifactColumns}
      FROM validation_run_artifacts
      WHERE validation_run_id = ?
      ORDER BY producer ASC,
        CASE
          WHEN ref LIKE '%/stdout.txt' THEN 1
          WHEN ref LIKE '%/stderr.txt' THEN 2
          WHEN ref LIKE '%/exit-code.json' THEN 3
          WHEN ref LIKE '%/logs.txt' THEN 4
          ELSE 5
        END,
        ref ASC
    `,
    [validationRunId],
  ).map(rowToValidationRunArtifact);

const recordValidationRunError = (
  database: DatabaseSync,
  input: RecordValidationRunErrorInput,
): RecordValidationRunErrorResult => {
  database.exec("BEGIN IMMEDIATE");

  try {
    const result = database
      .prepare("UPDATE validation_runs SET status = 'error', updated_at = ? WHERE id = ?")
      .run(input.now, input.validationRunId);

    if (result.changes === 0) {
      database.exec("ROLLBACK");
      return { ok: false, code: "VALIDATION_RUN_NOT_FOUND" };
    }

    database.exec("COMMIT");
    return { ok: true };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const recordValidationWorkspaceSetup = (
  database: DatabaseSync,
  input: RecordValidationWorkspaceSetupInput,
): RecordValidationRunErrorResult =>
  recordExistingValidationRunMutation(database, input.validationRunId, () => {
    database
      .prepare(`
        INSERT INTO validation_workspace_setups (
          validation_run_id,
          temp_ref_name,
          submitted_sha,
          worktree_head,
          cleanup_worktree,
          cleanup_temp_ref,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(validation_run_id) DO UPDATE SET
          temp_ref_name = excluded.temp_ref_name,
          submitted_sha = excluded.submitted_sha,
          worktree_head = excluded.worktree_head,
          cleanup_worktree = excluded.cleanup_worktree,
          cleanup_temp_ref = excluded.cleanup_temp_ref,
          created_at = excluded.created_at
      `)
      .run(
        input.validationRunId,
        input.tempRefName,
        input.submittedSha,
        input.worktreeHead,
        input.cleanupWorktree,
        input.cleanupTempRef,
        input.now,
      );

    database
      .prepare("UPDATE validation_runs SET updated_at = ? WHERE id = ?")
      .run(input.now, input.validationRunId);
  });

const recordValidationRunToolingError = (
  database: DatabaseSync,
  input: RecordValidationRunToolingErrorInput,
): RecordValidationRunErrorResult =>
  recordExistingValidationRunMutation(database, input.validationRunId, () => {
    recordValidationRunToolingErrorMutation(database, input);
  });

const recordExistingValidationRunMutation = (
  database: DatabaseSync,
  validationRunId: string,
  mutate: () => void,
): RecordValidationRunErrorResult => {
  database.exec("BEGIN IMMEDIATE");

  try {
    if (!validationRunExists(database, validationRunId)) {
      database.exec("ROLLBACK");
      return { ok: false, code: "VALIDATION_RUN_NOT_FOUND" };
    }

    mutate();
    database.exec("COMMIT");
    return { ok: true };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const rowToValidationRunSummary = (row: ValidationRunSummaryRow): ValidationRunSummaryRecord => ({
  id: row.id,
  taskValidationNumber: Number(row.taskValidationNumber),
  status: row.status,
  branch: row.branch,
  commitSha: row.commitSha,
  findingCount: Number(row.findingCount),
  toolingFailureCount: Number(row.toolingFailureCount),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const rowToValidationRunRecord = (row: ValidationRunRecordRow): ValidationRunRecord => ({
  id: row.id,
  taskId: row.taskId,
  taskValidationNumber: Number(row.taskValidationNumber),
  status: row.status,
  branch: row.branch,
  commitSha: row.commitSha,
  githubOwner: row.githubOwner,
  githubRepo: row.githubRepo,
  githubBaseBranch: row.githubBaseBranch,
  githubRemoteName: row.githubRemoteName,
  githubRemoteUrl: row.githubRemoteUrl,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const rowToValidationWorkspaceSetup = (
  row: ValidationWorkspaceSetupRow,
): ValidationWorkspaceSetupRecord => row;

const rowToValidationRunToolingError = (
  row: ValidationRunToolingErrorRow,
): ValidationRunToolingErrorRecord => ({
  sequence: Number(row.sequence),
  validationRunId: row.validationRunId,
  errorKind: row.errorKind,
  operationName: row.operationName,
  ...(row.tempRefName === null ? {} : { tempRefName: row.tempRefName }),
  ...(row.submittedSha === null ? {} : { submittedSha: row.submittedSha }),
  ...(row.worktreePath === null ? {} : { worktreePath: row.worktreePath }),
  errorMessage: row.errorMessage,
  ...(row.cleanupWorktree === null ? {} : { cleanupWorktree: row.cleanupWorktree }),
  ...(row.cleanupTempRef === null ? {} : { cleanupTempRef: row.cleanupTempRef }),
  createdAt: row.createdAt,
});

const rowToValidationRunPhaseStatus = (
  row: ValidationRunPhaseStatusRow,
): ValidationRunPhaseStatusRecord => row;

const rowToValidationRunRound = (row: ValidationRunRoundRow): ValidationRunRoundRecord => ({
  ...row,
  roundNumber: Number(row.roundNumber),
});

const rowToValidationRunFinding = (row: ValidationRunFindingRow): ValidationRunFindingRecord => ({
  ...row,
  files: decodeSqliteJsonStringArray(row.files),
  artifactRefs: decodeSqliteJsonStringArray(row.artifactRefs),
});

const rowToValidationRunArtifact = (row: ValidationRunArtifactRow): ValidationRunArtifactRecord =>
  row;

type ValidationRunIdRow = {
  readonly id: string;
};

type ValidationRunSummaryRow = Omit<
  ValidationRunSummaryRecord,
  "taskValidationNumber" | "findingCount" | "toolingFailureCount"
> & {
  readonly taskValidationNumber: number | bigint;
  readonly findingCount: number | bigint;
  readonly toolingFailureCount: number | bigint;
};

type ValidationRunRecordRow = {
  readonly id: string;
  readonly taskId: string;
  readonly taskValidationNumber: number | bigint;
  readonly status: ValidationRunRecord["status"];
  readonly branch: string;
  readonly commitSha: string;
  readonly githubOwner: string;
  readonly githubRepo: string;
  readonly githubBaseBranch: string;
  readonly githubRemoteName: string;
  readonly githubRemoteUrl: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type ValidationWorkspaceSetupRow = ValidationWorkspaceSetupRecord;

type ValidationRunPhaseStatusRow = ValidationRunPhaseStatusRecord;

type ValidationRunRoundRow = Omit<ValidationRunRoundRecord, "roundNumber"> & {
  readonly roundNumber: number | bigint;
};

type ValidationRunFindingRow = Omit<ValidationRunFindingRecord, "files" | "artifactRefs"> & {
  readonly files: string;
  readonly artifactRefs: string;
};

type ValidationRunArtifactRow = ValidationRunArtifactRecord;

type ValidationRunToolingErrorRow = Omit<
  ValidationRunToolingErrorRecord,
  | "sequence"
  | "tempRefName"
  | "submittedSha"
  | "worktreePath"
  | "cleanupWorktree"
  | "cleanupTempRef"
> & {
  readonly sequence: number | bigint;
  readonly tempRefName: string | null;
  readonly submittedSha: string | null;
  readonly worktreePath: string | null;
  readonly cleanupWorktree: NonNullable<ValidationRunToolingErrorRecord["cleanupWorktree"]> | null;
  readonly cleanupTempRef: NonNullable<ValidationRunToolingErrorRecord["cleanupTempRef"]> | null;
};
