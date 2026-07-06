import type { DatabaseSync } from "node:sqlite";

import { rollbackIfOpen, withStateDatabase, type SqliteStoreInput } from "./connection.js";
import { queryOne } from "./query.js";
import { recordRunToolingErrorMutation, runExists } from "./sqliteRunStore.js";
import { submitStateReadiness } from "../task/submitPolicy.js";
import { storedPublicTaskId, taskSlugForId, type PublicTaskId } from "../task/taskId.js";
import type { TaskState } from "../task/lifecycle.js";
import type {
  RecordValidationToolingFailureInput,
  RecordValidationToolingFailureResult,
  StartValidationRunInput,
  StartValidationRunResult,
  ValidationRuns,
} from "../validation/validationRuns.js";

export const openSqliteValidationRuns = (input: SqliteStoreInput): ValidationRuns => ({
  start: (startInput) =>
    withStateDatabase(input, (database) => startValidationRun(database, startInput)),
  recordToolingFailure: (toolingErrorInput) =>
    withStateDatabase(input, (database) => recordToolingFailure(database, toolingErrorInput)),
});

const startValidationRun = (
  database: DatabaseSync,
  input: StartValidationRunInput,
): StartValidationRunResult => {
  database.exec("BEGIN IMMEDIATE");

  try {
    const task = getTaskForSubmit(database, input.taskId);

    if (task === undefined) {
      database.exec("ROLLBACK");
      return { ok: false, code: "TASK_NOT_FOUND" };
    }

    const readiness = submitStateReadiness(task.state);

    if (!readiness.ok) {
      database.exec("ROLLBACK");
      return readiness;
    }

    const activeRun = queryOne<RunIdRow>(
      database,
      "SELECT id FROM runs WHERE task_id = ? AND status = 'active' LIMIT 1",
      [input.taskId],
    );

    if (activeRun !== undefined) {
      database.exec("ROLLBACK");
      return { ok: false, code: "TASK_HAS_ACTIVE_RUN" };
    }

    if (task.branch !== null && task.branch !== input.branch) {
      database.exec("ROLLBACK");
      return { ok: false, code: "TASK_BRANCH_MISMATCH", boundBranch: task.branch };
    }

    if (task.branch === null) {
      const branchOwner = queryOne<TaskIdRow>(
        database,
        "SELECT id FROM tasks WHERE branch = ? AND id <> ? LIMIT 1",
        [input.branch, input.taskId],
      );

      if (branchOwner !== undefined) {
        database.exec("ROLLBACK");
        return { ok: false, code: "BRANCH_ALREADY_BOUND", boundTaskId: branchOwner.id };
      }
    }

    const taskRunNumber = nextTaskRunNumber(database, input.taskId);
    const runId = `${taskSlugForId(input.taskId)}.${taskRunNumber}`;

    if (task.branch === null) {
      database.prepare("UPDATE tasks SET branch = ? WHERE id = ?").run(input.branch, input.taskId);
    }

    database
      .prepare(`
        INSERT INTO runs (
          id,
          task_id,
          task_run_number,
          status,
          branch,
          commit_sha,
          github_owner,
          github_repo,
          github_base_branch,
          github_remote_name,
          github_remote_url,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        runId,
        input.taskId,
        taskRunNumber,
        input.branch,
        input.commitSha,
        input.prTarget.owner,
        input.prTarget.repo,
        input.prTarget.baseBranch,
        input.prTarget.remoteName,
        input.prTarget.remoteUrl,
        input.now,
        input.now,
      );

    database
      .prepare("UPDATE tasks SET state = 'validating', updated_at = ? WHERE id = ?")
      .run(input.now, input.taskId);

    database.exec("COMMIT");

    return {
      ok: true,
      runId,
      taskState: "validating",
      previousTaskState: readiness.previousTaskState,
    };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const recordToolingFailure = (
  database: DatabaseSync,
  input: RecordValidationToolingFailureInput,
): RecordValidationToolingFailureResult => {
  database.exec("BEGIN IMMEDIATE");

  try {
    if (!runExists(database, input.runId)) {
      database.exec("ROLLBACK");
      return { ok: false, code: "RUN_NOT_FOUND" };
    }

    const { taskRecoveryState: _taskRecoveryState, ...runInput } = input;

    recordRunToolingErrorMutation(database, runInput);
    database
      .prepare(
        "UPDATE tasks SET state = ?, updated_at = ? WHERE id = (SELECT task_id FROM runs WHERE id = ?)",
      )
      .run(input.taskRecoveryState, input.now, input.runId);

    database.exec("COMMIT");
    return { ok: true };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const nextTaskRunNumber = (database: DatabaseSync, taskId: PublicTaskId): number => {
  const row = queryOne<TaskRunNumberRow>(
    database,
    "SELECT COALESCE(MAX(task_run_number), 0) + 1 AS taskRunNumber FROM runs WHERE task_id = ?",
    [taskId],
  );

  if (row === undefined) {
    throw new Error("Missing next task Run number");
  }

  return Number(row.taskRunNumber);
};

const getTaskForSubmit = (
  database: DatabaseSync,
  taskId: PublicTaskId,
): SubmitTaskRecord | undefined => {
  const row = queryOne<SubmitTaskRow>(
    database,
    "SELECT id, state, branch FROM tasks WHERE id = ?",
    [taskId],
  );

  if (row === undefined) {
    return undefined;
  }

  return {
    id: storedPublicTaskId(row.id),
    state: row.state,
    branch: row.branch,
  };
};

type SubmitTaskRecord = {
  readonly id: PublicTaskId;
  readonly state: TaskState;
  readonly branch: string | null;
};

type SubmitTaskRow = {
  readonly id: string;
  readonly state: TaskState;
  readonly branch: string | null;
};

type RunIdRow = {
  readonly id: string;
};

type TaskIdRow = {
  readonly id: string;
};

type TaskRunNumberRow = {
  readonly taskRunNumber: number | bigint;
};
