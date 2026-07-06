import type { DatabaseSync } from "node:sqlite";

import { rollbackIfOpen, withStateDatabase, type SqliteStoreInput } from "./connection.js";
import { queryOne } from "./query.js";
import { recordRunToolingErrorMutation, runExists } from "./runStore.js";
import type { GitHubPrTarget } from "../run/run.js";
import type { RecordRunErrorResult, RecordRunToolingErrorInput } from "../run/runStore.js";
import type { TaskState } from "../task/lifecycle.js";
import { canSubmitFrom, type SubmitEligibleState } from "../task/submitPolicy.js";
import { storedPublicTaskId, taskSlugForId, type PublicTaskId } from "../task/taskId.js";

/**
 * Transitional cross-store submit-start helper.
 *
 * This is the only v1 bridge that atomically touches TaskStore and RunStore data.
 * It preserves current submit-start behavior and workspace setup failure recovery until issue 026
 * moves validation start behind ValidationRuns and removes this exception.
 */
export type SubmitStartHelper = {
  readonly getTaskSubmitReadiness: (taskId: PublicTaskId) => TaskSubmitReadinessResult;
  readonly createRunFromSubmitPreflight: (
    input: CreateRunFromSubmitPreflightInput,
  ) => CreateRunFromSubmitPreflightResult;
  readonly recordRunToolingErrorAndRecoverTask: (
    input: RecordRunToolingErrorAndRecoverTaskInput,
  ) => RecordRunErrorResult;
};

export type RecordRunToolingErrorAndRecoverTaskInput = RecordRunToolingErrorInput & {
  readonly taskRecoveryState: SubmitEligibleState;
};

export type TaskSubmitReadinessResult =
  | {
      readonly ok: true;
      readonly taskId: PublicTaskId;
      readonly previousTaskState: SubmitEligibleState;
    }
  | {
      readonly ok: false;
      readonly code: "TASK_NOT_FOUND";
    }
  | {
      readonly ok: false;
      readonly code: "TASK_STATE_NOT_SUBMITTABLE";
      readonly state: TaskState;
    };

export type CreateRunFromSubmitPreflightInput = {
  readonly taskId: PublicTaskId;
  readonly branch: string;
  readonly commitSha: string;
  readonly prTarget: GitHubPrTarget;
  readonly now: string;
};

export type CreateRunFromSubmitPreflightResult =
  | {
      readonly ok: true;
      readonly runId: string;
      readonly taskState: "validating";
      readonly previousTaskState: SubmitEligibleState;
    }
  | {
      readonly ok: false;
      readonly code:
        | "TASK_NOT_FOUND"
        | "TASK_STATE_NOT_SUBMITTABLE"
        | "BRANCH_ALREADY_BOUND"
        | "TASK_BRANCH_MISMATCH"
        | "TASK_HAS_ACTIVE_RUN";
      readonly state?: TaskState;
      readonly boundBranch?: string;
      readonly boundTaskId?: string;
    };

export const openSqliteSubmitStartHelper = (input: SqliteStoreInput): SubmitStartHelper => ({
  getTaskSubmitReadiness: (taskId) =>
    withStateDatabase(input, (database) => getTaskSubmitReadiness(database, taskId)),
  createRunFromSubmitPreflight: (submitInput) =>
    withStateDatabase(input, (database) => createRunFromSubmitPreflight(database, submitInput)),
  recordRunToolingErrorAndRecoverTask: (toolingErrorInput) =>
    withStateDatabase(input, (database) =>
      recordRunToolingErrorAndRecoverTask(database, toolingErrorInput),
    ),
});

const getTaskSubmitReadiness = (
  database: DatabaseSync,
  taskId: PublicTaskId,
): TaskSubmitReadinessResult => {
  const task = getTaskForSubmit(database, taskId);

  if (task === undefined) {
    return { ok: false, code: "TASK_NOT_FOUND" };
  }

  if (!canSubmitFrom(task.state)) {
    return { ok: false, code: "TASK_STATE_NOT_SUBMITTABLE", state: task.state };
  }

  return { ok: true, taskId, previousTaskState: task.state };
};

const createRunFromSubmitPreflight = (
  database: DatabaseSync,
  input: CreateRunFromSubmitPreflightInput,
): CreateRunFromSubmitPreflightResult => {
  database.exec("BEGIN IMMEDIATE");

  try {
    const readiness = getTaskSubmitReadiness(database, input.taskId);

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

    const task = getTaskForSubmit(database, input.taskId);

    if (task === undefined) {
      database.exec("ROLLBACK");
      return { ok: false, code: "TASK_NOT_FOUND" };
    }

    if (!canSubmitFrom(task.state)) {
      throw new Error("Task state is not submittable");
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
      previousTaskState: task.state,
    };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const recordRunToolingErrorAndRecoverTask = (
  database: DatabaseSync,
  input: RecordRunToolingErrorAndRecoverTaskInput,
): RecordRunErrorResult => {
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
