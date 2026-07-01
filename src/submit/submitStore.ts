import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { ensureStateDatabase, stateDatabaseTimeoutMs } from "../init/stateDatabase.js";
import { isSubmittableTaskState, type TaskState } from "../task/task.js";
import type { PublicTaskId } from "../task/taskId.js";
import type { GitHubPrTarget } from "./githubTarget.js";

export type SubmitTaskRecord = {
  readonly id: PublicTaskId;
  readonly state: TaskState;
  readonly branch: string | null;
};

export type CreateRunFromPreflightInput = {
  readonly taskId: PublicTaskId;
  readonly branch: string;
  readonly commitSha: string;
  readonly prTarget: GitHubPrTarget;
  readonly now: string;
};

export type CreateRunFromPreflightResult =
  | {
      readonly ok: true;
      readonly runId: string;
      readonly taskState: "validating";
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

export type DurableSubmitState = {
  readonly getTaskForSubmit: (taskId: PublicTaskId) => SubmitTaskRecord | undefined;
  readonly createRunFromPreflight: (
    input: CreateRunFromPreflightInput,
  ) => CreateRunFromPreflightResult;
};

export class DurableSubmitStateUnavailableError extends Error {
  constructor() {
    super("Durable submit state is unavailable");
  }
}

type DurableSubmitStateInput = {
  readonly statePath: string;
};

export const openDurableSubmitState = (input: DurableSubmitStateInput): DurableSubmitState => {
  const withDatabase = <Result>(work: (database: DatabaseSync) => Result): Result => {
    if (!existsSync(input.statePath)) {
      throw new DurableSubmitStateUnavailableError();
    }

    ensureStateDatabase(input.statePath);
    const database = new DatabaseSync(input.statePath, { timeout: stateDatabaseTimeoutMs });

    try {
      return work(database);
    } finally {
      database.close();
    }
  };

  return {
    getTaskForSubmit: (taskId) => withDatabase((database) => getTaskForSubmit(database, taskId)),
    createRunFromPreflight: (submitInput) =>
      withDatabase((database) => createRunFromPreflight(database, submitInput)),
  };
};

const getTaskForSubmit = (
  database: DatabaseSync,
  taskId: PublicTaskId,
): SubmitTaskRecord | undefined => {
  const row = database.prepare("SELECT id, state, branch FROM tasks WHERE id = ?").get(taskId);

  if (row === undefined) {
    return undefined;
  }

  if (!isSubmitTaskRow(row)) {
    throw new Error("Invalid submit task row");
  }

  return {
    id: row.id as PublicTaskId,
    state: row.state,
    branch: row.branch,
  };
};

const createRunFromPreflight = (
  database: DatabaseSync,
  input: CreateRunFromPreflightInput,
): CreateRunFromPreflightResult => {
  database.exec("BEGIN IMMEDIATE");

  try {
    const task = getTaskForSubmit(database, input.taskId);

    if (task === undefined) {
      database.exec("ROLLBACK");
      return { ok: false, code: "TASK_NOT_FOUND" };
    }

    if (!isSubmittableTaskState(task.state)) {
      database.exec("ROLLBACK");
      return { ok: false, code: "TASK_STATE_NOT_SUBMITTABLE", state: task.state };
    }

    const activeRun = database
      .prepare("SELECT id FROM runs WHERE task_id = ? AND status = 'active' LIMIT 1")
      .get(input.taskId);

    if (activeRun !== undefined) {
      database.exec("ROLLBACK");
      return { ok: false, code: "TASK_HAS_ACTIVE_RUN" };
    }

    if (task.branch !== null && task.branch !== input.branch) {
      database.exec("ROLLBACK");
      return { ok: false, code: "TASK_BRANCH_MISMATCH", boundBranch: task.branch };
    }

    if (task.branch === null) {
      const branchOwner = database
        .prepare("SELECT id FROM tasks WHERE branch = ? AND id <> ? LIMIT 1")
        .get(input.branch, input.taskId);

      if (branchOwner !== undefined) {
        if (!isTaskIdRow(branchOwner)) {
          throw new Error("Invalid branch owner row");
        }

        database.exec("ROLLBACK");
        return { ok: false, code: "BRANCH_ALREADY_BOUND", boundTaskId: branchOwner.id };
      }
    }

    const taskRunNumber = nextTaskRunNumber(database, input.taskId);
    const runId = `${input.taskId}.${taskRunNumber}`;

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

    return { ok: true, runId, taskState: "validating" };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const nextTaskRunNumber = (database: DatabaseSync, taskId: PublicTaskId): number => {
  const row = database
    .prepare(
      "SELECT COALESCE(MAX(task_run_number), 0) + 1 AS taskRunNumber FROM runs WHERE task_id = ?",
    )
    .get(taskId);

  if (!isTaskRunNumberRow(row)) {
    throw new Error("Missing next task Run number");
  }

  return Number(row.taskRunNumber);
};

const rollbackIfOpen = (database: DatabaseSync): void => {
  try {
    database.exec("ROLLBACK");
  } catch {
    // The transaction may already be rolled back for expected domain failures.
  }
};

type SubmitTaskRow = {
  readonly id: string;
  readonly state: TaskState;
  readonly branch: string | null;
};

type TaskIdRow = {
  readonly id: string;
};

type TaskRunNumberRow = {
  readonly taskRunNumber: number | bigint;
};

const isSubmitTaskRow = (value: unknown): value is SubmitTaskRow =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { readonly id?: unknown }).id === "string" &&
  isTaskState((value as { readonly state?: unknown }).state) &&
  isNullableString((value as { readonly branch?: unknown }).branch);

const isTaskState = (value: unknown): value is TaskState =>
  value === "todo" ||
  value === "implementing" ||
  value === "validating" ||
  value === "needs_input" ||
  value === "ready" ||
  value === "done";

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

const isTaskIdRow = (value: unknown): value is TaskIdRow =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { readonly id?: unknown }).id === "string";

const isTaskRunNumberRow = (value: unknown): value is TaskRunNumberRow =>
  typeof value === "object" &&
  value !== null &&
  (typeof (value as { readonly taskRunNumber?: unknown }).taskRunNumber === "number" ||
    typeof (value as { readonly taskRunNumber?: unknown }).taskRunNumber === "bigint");
