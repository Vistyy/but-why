import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { ensureStateDatabase, stateDatabaseTimeoutMs } from "../init/stateDatabase.js";
import {
  isTaskState,
  type TaskContext,
  type TaskRecord,
  type TaskState,
  type TaskSummary,
} from "./task.js";
import type { PublicTaskId } from "./taskId.js";

export type DurableTaskState = {
  readonly createTask: (input: CreateTaskInput) => TaskSummary;
  readonly listTasks: (input: ListTasksInput) => readonly TaskSummary[];
  readonly listActionableTasks: () => readonly TaskSummary[];
  readonly getTaskById: (taskId: PublicTaskId) => TaskRecord | undefined;
  readonly getTaskContextById: (taskId: PublicTaskId) => TaskContext | undefined;
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

export class DurableTaskStateUnavailableError extends Error {
  constructor() {
    super("Durable Task state is unavailable");
  }
}

type DurableTaskStateInput = {
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

export const openDurableTaskState = (input: DurableTaskStateInput): DurableTaskState => {
  const withDatabase = <Result>(work: (database: DatabaseSync) => Result): Result => {
    if (!existsSync(input.statePath)) {
      throw new DurableTaskStateUnavailableError();
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

type NumericIdRow = {
  readonly numericId: number | bigint;
};

const isNumericIdRow = (value: unknown): value is NumericIdRow =>
  typeof value === "object" &&
  value !== null &&
  "numericId" in value &&
  (typeof value.numericId === "number" || typeof value.numericId === "bigint");

type TaskSummaryRow = TaskSummary;

type TaskRecordRow = TaskSummary & {
  readonly description: string;
  readonly branch: string | null;
  readonly latestRun: string | null;
  readonly commentCount: number | bigint;
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
