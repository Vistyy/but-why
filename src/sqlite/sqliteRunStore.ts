import type { DatabaseSync } from "node:sqlite";

import { rollbackIfOpen, withStateDatabase, type SqliteStoreInput } from "./connection.js";
import { queryAll, queryOne } from "./query.js";
import { recordRunToolingErrorMutation, runExists } from "./sqliteRunInternals.js";
import type { RunRecord } from "../run/run.js";
import type {
  RecordRunErrorInput,
  RecordRunErrorResult,
  RecordRunToolingErrorInput,
  RecordValidationWorkspaceSetupInput,
  RunStore,
  RunToolingErrorRecord,
  ValidationWorkspaceSetupRecord,
} from "../run/runStore.js";

const runRecordColumns = [
  "id",
  "task_id AS taskId",
  "task_run_number AS taskRunNumber",
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
  "run_id AS runId",
  "temp_ref_name AS tempRefName",
  "submitted_sha AS submittedSha",
  "worktree_path AS worktreePath",
  "worktree_head AS worktreeHead",
  "cleanup_worktree AS cleanupWorktree",
  "cleanup_temp_ref AS cleanupTempRef",
  "created_at AS createdAt",
].join(", ");
const runToolingErrorColumns = [
  "sequence",
  "run_id AS runId",
  "operation_name AS operationName",
  "temp_ref_name AS tempRefName",
  "submitted_sha AS submittedSha",
  "worktree_path AS worktreePath",
  "error_message AS errorMessage",
  "cleanup_worktree AS cleanupWorktree",
  "cleanup_temp_ref AS cleanupTempRef",
  "created_at AS createdAt",
].join(", ");

export const openSqliteRunStore = (input: SqliteStoreInput): RunStore => ({
  getRunById: (runId) => withStateDatabase(input, (database) => getRunById(database, runId)),
  getLatestRunIdForTask: (taskId) =>
    withStateDatabase(input, (database) => getLatestRunIdForTask(database, taskId)),
  getValidationWorkspaceSetup: (runId) =>
    withStateDatabase(input, (database) => getValidationWorkspaceSetup(database, runId)),
  listRunToolingErrors: (runId) =>
    withStateDatabase(input, (database) => listRunToolingErrors(database, runId)),
  recordRunError: (runInput) =>
    withStateDatabase(input, (database) => recordRunError(database, runInput)),
  recordValidationWorkspaceSetup: (runInput) =>
    withStateDatabase(input, (database) => recordValidationWorkspaceSetup(database, runInput)),
  recordRunToolingError: (runInput) =>
    withStateDatabase(input, (database) => recordRunToolingError(database, runInput)),
});

const getRunById = (database: DatabaseSync, runId: string): RunRecord | undefined => {
  const row = queryOne<RunRecordRow>(
    database,
    `
      SELECT ${runRecordColumns}
      FROM runs
      WHERE id = ?
    `,
    [runId],
  );

  if (row === undefined) {
    return undefined;
  }

  return rowToRunRecord(row);
};

const getLatestRunIdForTask = (database: DatabaseSync, taskId: string): string | null => {
  const row = queryOne<RunIdRow>(
    database,
    "SELECT id FROM runs WHERE task_id = ? ORDER BY task_run_number DESC LIMIT 1",
    [taskId],
  );

  return row?.id ?? null;
};

const getValidationWorkspaceSetup = (
  database: DatabaseSync,
  runId: string,
): ValidationWorkspaceSetupRecord | undefined => {
  const row = queryOne<ValidationWorkspaceSetupRow>(
    database,
    `
      SELECT ${validationWorkspaceSetupColumns}
      FROM validation_workspace_setups
      WHERE run_id = ?
    `,
    [runId],
  );

  if (row === undefined) {
    return undefined;
  }

  return rowToValidationWorkspaceSetup(row);
};

const listRunToolingErrors = (
  database: DatabaseSync,
  runId: string,
): readonly RunToolingErrorRecord[] =>
  queryAll<RunToolingErrorRow>(
    database,
    `
      SELECT ${runToolingErrorColumns}
      FROM run_tooling_errors
      WHERE run_id = ?
      ORDER BY sequence ASC
    `,
    [runId],
  ).map(rowToRunToolingError);

const recordRunError = (
  database: DatabaseSync,
  input: RecordRunErrorInput,
): RecordRunErrorResult => {
  database.exec("BEGIN IMMEDIATE");

  try {
    const result = database
      .prepare("UPDATE runs SET status = 'error', updated_at = ? WHERE id = ?")
      .run(input.now, input.runId);

    if (result.changes === 0) {
      database.exec("ROLLBACK");
      return { ok: false, code: "RUN_NOT_FOUND" };
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
): RecordRunErrorResult =>
  recordExistingRunMutation(database, input.runId, () => {
    database
      .prepare(`
        INSERT INTO validation_workspace_setups (
          run_id,
          temp_ref_name,
          submitted_sha,
          worktree_path,
          worktree_head,
          cleanup_worktree,
          cleanup_temp_ref,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET
          temp_ref_name = excluded.temp_ref_name,
          submitted_sha = excluded.submitted_sha,
          worktree_path = excluded.worktree_path,
          worktree_head = excluded.worktree_head,
          cleanup_worktree = excluded.cleanup_worktree,
          cleanup_temp_ref = excluded.cleanup_temp_ref,
          created_at = excluded.created_at
      `)
      .run(
        input.runId,
        input.tempRefName,
        input.submittedSha,
        input.worktreePath,
        input.worktreeHead,
        input.cleanupWorktree,
        input.cleanupTempRef,
        input.now,
      );

    database.prepare("UPDATE runs SET updated_at = ? WHERE id = ?").run(input.now, input.runId);
  });

const recordRunToolingError = (
  database: DatabaseSync,
  input: RecordRunToolingErrorInput,
): RecordRunErrorResult =>
  recordExistingRunMutation(database, input.runId, () => {
    recordRunToolingErrorMutation(database, input);
  });

const recordExistingRunMutation = (
  database: DatabaseSync,
  runId: string,
  mutate: () => void,
): RecordRunErrorResult => {
  database.exec("BEGIN IMMEDIATE");

  try {
    if (!runExists(database, runId)) {
      database.exec("ROLLBACK");
      return { ok: false, code: "RUN_NOT_FOUND" };
    }

    mutate();
    database.exec("COMMIT");
    return { ok: true };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const rowToRunRecord = (row: RunRecordRow): RunRecord => ({
  id: row.id,
  taskId: row.taskId,
  taskRunNumber: Number(row.taskRunNumber),
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

const rowToRunToolingError = (row: RunToolingErrorRow): RunToolingErrorRecord => ({
  sequence: Number(row.sequence),
  runId: row.runId,
  operationName: row.operationName,
  tempRefName: row.tempRefName,
  submittedSha: row.submittedSha,
  ...(row.worktreePath === null ? {} : { worktreePath: row.worktreePath }),
  errorMessage: row.errorMessage,
  cleanupWorktree: row.cleanupWorktree,
  cleanupTempRef: row.cleanupTempRef,
  createdAt: row.createdAt,
});

type RunIdRow = {
  readonly id: string;
};

type RunRecordRow = {
  readonly id: string;
  readonly taskId: string;
  readonly taskRunNumber: number | bigint;
  readonly status: RunRecord["status"];
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

type RunToolingErrorRow = Omit<RunToolingErrorRecord, "sequence" | "worktreePath"> & {
  readonly sequence: number | bigint;
  readonly worktreePath: string | null;
};
