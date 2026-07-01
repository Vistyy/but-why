import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { ensureStateDatabase, stateDatabaseTimeoutMs } from "./init/stateDatabase.js";
import { isRunStatus, type GitHubPrTarget, type RunRecord } from "./run/run.js";
import {
  isSubmittableTaskState,
  isTaskState,
  type TaskContext,
  type TaskRecord,
  type TaskState,
  type TaskSummary,
} from "./task/task.js";
import type { PublicTaskId } from "./task/taskId.js";

/**
 * Future validation workspace and validation gate code should use this durable state interface.
 * It owns local Task and Run persistence, transactions, IDs, branch binding, and row validation.
 */
export type RepoState = {
  readonly createTask: (input: CreateTaskInput) => TaskSummary;
  readonly listTasks: (input: ListTasksInput) => readonly TaskSummary[];
  readonly listActionableTasks: () => readonly TaskSummary[];
  readonly getTaskById: (taskId: PublicTaskId) => TaskRecord | undefined;
  readonly getTaskContextById: (taskId: PublicTaskId) => TaskContext | undefined;
  readonly getRunById: (runId: string) => RunRecord | undefined;
  readonly getTaskSubmitReadiness: (taskId: PublicTaskId) => TaskSubmitReadinessResult;
  readonly createRunFromSubmitPreflight: (
    input: CreateRunFromSubmitPreflightInput,
  ) => CreateRunFromSubmitPreflightResult;
  readonly recordRunError: (input: RecordRunErrorInput) => RecordRunErrorResult;
  readonly appendTaskComment: (
    input: AppendTaskCommentInput,
  ) => AppendTaskCommentResult | undefined;
  readonly transitionTaskState: (input: TransitionTaskStateInput) => TaskStateTransitionResult;
};

export type CreateTaskInput = {
  readonly title: string;
  readonly description: string;
  readonly now: string;
};

export type ListTasksInput = {
  readonly includeDone: boolean;
  readonly state?: TaskState;
};

export type AppendTaskCommentInput = {
  readonly taskId: PublicTaskId;
  readonly content: string;
  readonly now: () => string;
};

export type AppendTaskCommentResult = {
  readonly taskId: PublicTaskId;
  readonly commentCount: number;
};

export type TransitionTaskStateInput = {
  readonly taskId: PublicTaskId;
  readonly to: TaskState;
  readonly now: string;
};

export type TaskStateTransitionResult =
  | {
      readonly ok: true;
      readonly changed: boolean;
      readonly task: TaskRecord;
    }
  | {
      readonly ok: false;
      readonly code: "task_not_found";
    }
  | {
      readonly ok: false;
      readonly code: "invalid_task_state_transition";
      readonly from: TaskState;
      readonly to: TaskState;
    };

export type TaskSubmitReadinessResult =
  | {
      readonly ok: true;
      readonly taskId: PublicTaskId;
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

export type RecordRunErrorInput = {
  readonly runId: string;
  readonly now: string;
};

export type RecordRunErrorResult =
  | {
      readonly ok: true;
    }
  | {
      readonly ok: false;
      readonly code: "RUN_NOT_FOUND";
    };

export class RepoStateUnavailableError extends Error {
  constructor() {
    super("Durable Task state is unavailable");
  }
}

type RepoStateInput = {
  readonly statePath: string;
  readonly taskPrefix: string;
};

const taskTimestampColumns = ["created_at AS createdAt", "updated_at AS updatedAt"];
const taskSummaryColumns = ["id", "title", "state", ...taskTimestampColumns].join(", ");
const taskRecordColumns = [
  "id",
  "title",
  "description",
  "state",
  ...taskTimestampColumns,
  "branch",
  "(SELECT id FROM runs WHERE task_id = tasks.id ORDER BY task_run_number DESC LIMIT 1) AS latestRun",
  "(SELECT COUNT(*) FROM task_comments WHERE task_id = tasks.id) AS commentCount",
].join(", ");
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
  ...taskTimestampColumns,
].join(", ");

/**
 * V1 Task lifecycle transitions live here so lifecycle commands do not encode SQL or state rules.
 * Issue 008 uses todo to implementing and the implementing no-op.
 * Submit, validation, publishing, and reconciliation issues use the remaining transitions in this graph.
 */
const validTaskStateTransitions: ReadonlyMap<TaskState, readonly TaskState[]> = new Map([
  ["todo", ["implementing"]],
  ["implementing", ["validating"]],
  ["validating", ["needs_input", "ready"]],
  ["needs_input", ["validating"]],
  ["ready", ["done", "needs_input"]],
  ["done", []],
]);

export const openRepoState = (input: RepoStateInput): RepoState => {
  const withDatabase = <Result>(work: (database: DatabaseSync) => Result): Result => {
    if (!existsSync(input.statePath)) {
      throw new RepoStateUnavailableError();
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
    createTask: (taskInput) =>
      withDatabase((database) => createTask(database, input.taskPrefix, taskInput)),
    listTasks: (taskInput) => withDatabase((database) => listTasks(database, taskInput)),
    listActionableTasks: () => withDatabase(listActionableTasks),
    getTaskById: (taskId) => withDatabase((database) => getTaskById(database, taskId)),
    getTaskContextById: (taskId) =>
      withDatabase((database) => getTaskContextById(database, taskId)),
    getRunById: (runId) => withDatabase((database) => getRunById(database, runId)),
    getTaskSubmitReadiness: (taskId) =>
      withDatabase((database) => getTaskSubmitReadiness(database, taskId)),
    createRunFromSubmitPreflight: (submitInput) =>
      withDatabase((database) => createRunFromSubmitPreflight(database, submitInput)),
    recordRunError: (runInput) => withDatabase((database) => recordRunError(database, runInput)),
    appendTaskComment: (taskInput) =>
      withDatabase((database) => appendTaskComment(database, taskInput)),
    transitionTaskState: (taskInput) =>
      withDatabase((database) => transitionTaskState(database, taskInput)),
  };
};

const createTask = (
  database: DatabaseSync,
  taskPrefix: string,
  input: CreateTaskInput,
): TaskSummary => {
  database.exec("BEGIN IMMEDIATE");

  try {
    const numericId = nextTaskNumericId(database);
    const id = `${taskPrefix}-${numericId}`;

    database
      .prepare(`
        INSERT INTO tasks (id, numeric_id, title, description, state, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(id, numericId, input.title, input.description, "todo", input.now, input.now);

    database.exec("COMMIT");

    return {
      id,
      title: input.title,
      state: "todo",
      createdAt: input.now,
      updatedAt: input.now,
    };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
};

const listTasks = (database: DatabaseSync, input: ListTasksInput): readonly TaskSummary[] => {
  const rows = input.state
    ? database
        .prepare(`
          SELECT ${taskSummaryColumns}
          FROM tasks
          WHERE state = ?
          ORDER BY created_at ASC, numeric_id ASC
        `)
        .all(input.state)
    : input.includeDone
      ? database
          .prepare(`
            SELECT ${taskSummaryColumns}
            FROM tasks
            ORDER BY created_at ASC, numeric_id ASC
          `)
          .all()
      : database
          .prepare(`
            SELECT ${taskSummaryColumns}
            FROM tasks
            WHERE state <> 'done'
            ORDER BY created_at ASC, numeric_id ASC
          `)
          .all();

  return rows.map(rowToTaskSummary);
};

const listActionableTasks = (database: DatabaseSync): readonly TaskSummary[] =>
  database
    .prepare(`
      SELECT ${taskSummaryColumns}
      FROM tasks
      WHERE state IN ('todo', 'needs_input', 'ready')
      ORDER BY
        CASE state
          WHEN 'needs_input' THEN 0
          WHEN 'ready' THEN 1
          WHEN 'todo' THEN 2
        END ASC,
        updated_at DESC,
        numeric_id ASC
    `)
    .all()
    .map(rowToTaskSummary);

const getTaskById = (database: DatabaseSync, taskId: PublicTaskId): TaskRecord | undefined => {
  const row = database
    .prepare(`
      SELECT ${taskRecordColumns}
      FROM tasks
      WHERE id = ?
    `)
    .get(taskId);

  if (row === undefined) {
    return undefined;
  }

  return rowToTaskRecord(row);
};

const getRunById = (database: DatabaseSync, runId: string): RunRecord | undefined => {
  const row = database
    .prepare(`
      SELECT ${runRecordColumns}
      FROM runs
      WHERE id = ?
    `)
    .get(runId);

  if (row === undefined) {
    return undefined;
  }

  return rowToRunRecord(row);
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

const getTaskContextById = (
  database: DatabaseSync,
  taskId: PublicTaskId,
): TaskContext | undefined => {
  const row = database
    .prepare(`
      SELECT id, title, description
      FROM tasks
      WHERE id = ?
    `)
    .get(taskId);

  if (row === undefined) {
    return undefined;
  }

  const task = rowToTaskContextHeader(row);
  const comments = database
    .prepare(`
      SELECT content
      FROM task_comments
      WHERE task_id = ?
      ORDER BY sequence ASC
    `)
    .all(taskId)
    .map(rowToCommentContent);

  return { ...task, comments };
};

const getTaskSubmitReadiness = (
  database: DatabaseSync,
  taskId: PublicTaskId,
): TaskSubmitReadinessResult => {
  const task = getTaskForSubmit(database, taskId);

  if (task === undefined) {
    return { ok: false, code: "TASK_NOT_FOUND" };
  }

  if (!isSubmittableTaskState(task.state)) {
    return { ok: false, code: "TASK_STATE_NOT_SUBMITTABLE", state: task.state };
  }

  return { ok: true, taskId };
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

    const activeRun = database
      .prepare("SELECT id FROM runs WHERE task_id = ? AND status = 'active' LIMIT 1")
      .get(input.taskId);

    if (activeRun !== undefined) {
      database.exec("ROLLBACK");
      return { ok: false, code: "TASK_HAS_ACTIVE_RUN" };
    }

    const task = getTaskForSubmit(database, input.taskId);

    if (task === undefined) {
      database.exec("ROLLBACK");
      return { ok: false, code: "TASK_NOT_FOUND" };
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

const appendTaskComment = (
  database: DatabaseSync,
  input: AppendTaskCommentInput,
): AppendTaskCommentResult | undefined => {
  database.exec("BEGIN IMMEDIATE");

  try {
    const task = database.prepare("SELECT id FROM tasks WHERE id = ?").get(input.taskId);

    if (task === undefined) {
      database.exec("ROLLBACK");
      return undefined;
    }

    const now = input.now();

    database
      .prepare(`
        INSERT INTO task_comments (id, task_id, created_at, content)
        VALUES (?, ?, ?, ?)
      `)
      .run(randomUUID(), input.taskId, now, input.content);

    database.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(now, input.taskId);

    const count = commentCountForTask(database, input.taskId);

    database.exec("COMMIT");

    return { taskId: input.taskId, commentCount: count };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
};

const transitionTaskState = (
  database: DatabaseSync,
  input: TransitionTaskStateInput,
): TaskStateTransitionResult => {
  database.exec("BEGIN IMMEDIATE");

  try {
    const current = getTaskById(database, input.taskId);

    if (current === undefined) {
      database.exec("ROLLBACK");
      return { ok: false, code: "task_not_found" };
    }

    if (current.state === input.to) {
      if (input.to === "implementing") {
        database.exec("COMMIT");
        return { ok: true, changed: false, task: current };
      }

      database.exec("ROLLBACK");
      return {
        ok: false,
        code: "invalid_task_state_transition",
        from: current.state,
        to: input.to,
      };
    }

    if (!canTransitionTaskState(current.state, input.to)) {
      database.exec("ROLLBACK");
      return {
        ok: false,
        code: "invalid_task_state_transition",
        from: current.state,
        to: input.to,
      };
    }

    database
      .prepare("UPDATE tasks SET state = ?, updated_at = ? WHERE id = ?")
      .run(input.to, input.now, input.taskId);

    const updated = getTaskById(database, input.taskId);

    if (updated === undefined) {
      throw new Error("Task disappeared during state transition");
    }

    database.exec("COMMIT");

    return { ok: true, changed: true, task: updated };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const canTransitionTaskState = (from: TaskState, to: TaskState): boolean =>
  validTaskStateTransitions.get(from)?.includes(to) ?? false;

const rollbackIfOpen = (database: DatabaseSync): void => {
  try {
    database.exec("ROLLBACK");
  } catch {
    // The transaction may already be rolled back for expected domain failures.
  }
};

const nextTaskNumericId = (database: DatabaseSync): number => {
  const row = database
    .prepare("SELECT COALESCE(MAX(numeric_id), 0) + 1 AS numericId FROM tasks")
    .get();

  if (!isNumericIdRow(row)) {
    throw new Error("Missing next task numeric ID");
  }

  return Number(row.numericId);
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

const rowToTaskSummary = (row: unknown): TaskSummary => {
  if (!isTaskSummaryRow(row)) {
    throw new Error("Invalid task row");
  }

  return {
    id: row.id,
    title: row.title,
    state: row.state,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

const rowToTaskRecord = (row: unknown): TaskRecord => {
  if (!isTaskRecordRow(row)) {
    throw new Error("Invalid task row");
  }

  return {
    ...rowToTaskSummary(row),
    description: row.description,
    branch: row.branch,
    latestRun: row.latestRun,
    commentCount: Number(row.commentCount),
  };
};

const rowToRunRecord = (row: unknown): RunRecord => {
  if (!isRunRecordRow(row)) {
    throw new Error("Invalid Run row");
  }

  return {
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
  };
};

const rowToTaskContextHeader = (row: unknown): Omit<TaskContext, "comments"> => {
  if (!isTaskContextHeaderRow(row)) {
    throw new Error("Invalid task context row");
  }

  return {
    id: row.id,
    title: row.title,
    description: row.description,
  };
};

const rowToCommentContent = (row: unknown): string => {
  if (!isCommentContentRow(row)) {
    throw new Error("Invalid task comment row");
  }

  return row.content;
};

const commentCountForTask = (database: DatabaseSync, taskId: PublicTaskId): number => {
  const row = database
    .prepare("SELECT COUNT(*) AS commentCount FROM task_comments WHERE task_id = ?")
    .get(taskId);

  if (!isCommentCountRow(row)) {
    throw new Error("Missing comment count");
  }

  return Number(row.commentCount);
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

type TaskIdRow = {
  readonly id: string;
};

type NumericIdRow = {
  readonly numericId: number | bigint;
};

type TaskRunNumberRow = {
  readonly taskRunNumber: number | bigint;
};

const isNumericIdRow = (value: unknown): value is NumericIdRow =>
  typeof value === "object" &&
  value !== null &&
  "numericId" in value &&
  (typeof value.numericId === "number" || typeof value.numericId === "bigint");

const isSubmitTaskRow = (value: unknown): value is SubmitTaskRow =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { readonly id?: unknown }).id === "string" &&
  typeof (value as { readonly state?: unknown }).state === "string" &&
  isTaskState((value as { readonly state: string }).state) &&
  isNullableString((value as { readonly branch?: unknown }).branch);

const isTaskIdRow = (value: unknown): value is TaskIdRow =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { readonly id?: unknown }).id === "string";

const isTaskRunNumberRow = (value: unknown): value is TaskRunNumberRow =>
  typeof value === "object" &&
  value !== null &&
  (typeof (value as { readonly taskRunNumber?: unknown }).taskRunNumber === "number" ||
    typeof (value as { readonly taskRunNumber?: unknown }).taskRunNumber === "bigint");

type TaskSummaryRow = TaskSummary;

type TaskRecordRow = TaskSummary & {
  readonly description: string;
  readonly branch: string | null;
  readonly latestRun: string | null;
  readonly commentCount: number | bigint;
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

type TaskContextHeaderRow = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
};

type CommentContentRow = {
  readonly content: string;
};

type CommentCountRow = {
  readonly commentCount: number | bigint;
};

const isTaskSummaryRow = (value: unknown): value is TaskSummaryRow =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { readonly id?: unknown }).id === "string" &&
  typeof (value as { readonly title?: unknown }).title === "string" &&
  typeof (value as { readonly state?: unknown }).state === "string" &&
  isTaskState((value as { readonly state: string }).state) &&
  typeof (value as { readonly createdAt?: unknown }).createdAt === "string" &&
  typeof (value as { readonly updatedAt?: unknown }).updatedAt === "string";

const isTaskRecordRow = (value: unknown): value is TaskRecordRow =>
  isTaskSummaryRow(value) &&
  typeof (value as { readonly description?: unknown }).description === "string" &&
  isNullableString((value as { readonly branch?: unknown }).branch) &&
  isNullableString((value as { readonly latestRun?: unknown }).latestRun) &&
  isCount((value as { readonly commentCount?: unknown }).commentCount);

const isRunRecordRow = (value: unknown): value is RunRecordRow =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { readonly id?: unknown }).id === "string" &&
  typeof (value as { readonly taskId?: unknown }).taskId === "string" &&
  isCount((value as { readonly taskRunNumber?: unknown }).taskRunNumber) &&
  typeof (value as { readonly status?: unknown }).status === "string" &&
  isRunStatus((value as { readonly status: string }).status) &&
  typeof (value as { readonly branch?: unknown }).branch === "string" &&
  typeof (value as { readonly commitSha?: unknown }).commitSha === "string" &&
  typeof (value as { readonly githubOwner?: unknown }).githubOwner === "string" &&
  typeof (value as { readonly githubRepo?: unknown }).githubRepo === "string" &&
  typeof (value as { readonly githubBaseBranch?: unknown }).githubBaseBranch === "string" &&
  typeof (value as { readonly githubRemoteName?: unknown }).githubRemoteName === "string" &&
  typeof (value as { readonly githubRemoteUrl?: unknown }).githubRemoteUrl === "string" &&
  typeof (value as { readonly createdAt?: unknown }).createdAt === "string" &&
  typeof (value as { readonly updatedAt?: unknown }).updatedAt === "string";

const isTaskContextHeaderRow = (value: unknown): value is TaskContextHeaderRow =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { readonly id?: unknown }).id === "string" &&
  typeof (value as { readonly title?: unknown }).title === "string" &&
  typeof (value as { readonly description?: unknown }).description === "string";

const isCommentContentRow = (value: unknown): value is CommentContentRow =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { readonly content?: unknown }).content === "string";

const isCommentCountRow = (value: unknown): value is CommentCountRow =>
  typeof value === "object" &&
  value !== null &&
  isCount((value as { readonly commentCount?: unknown }).commentCount);

const isCount = (value: unknown): value is number | bigint =>
  typeof value === "number" || typeof value === "bigint";

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";
