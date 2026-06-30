import { randomUUID } from "node:crypto";
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

export type CreateTaskInput = {
  readonly statePath: string;
  readonly taskPrefix: string;
  readonly title: string;
  readonly description: string;
  readonly now: string;
};

export type ListTasksInput = {
  readonly statePath: string;
  readonly includeDone: boolean;
  readonly state?: TaskState;
};

export type AppendTaskCommentInput = {
  readonly statePath: string;
  readonly taskId: PublicTaskId;
  readonly content: string;
  readonly now: () => string;
};

export type AppendTaskCommentResult = {
  readonly taskId: PublicTaskId;
  readonly commentCount: number;
};

const taskTimestampColumns = ["created_at AS createdAt", "updated_at AS updatedAt"];
const taskSummaryColumns = ["id", "title", "state", ...taskTimestampColumns].join(", ");
const taskRecordColumns = [
  "id",
  "title",
  "description",
  "state",
  ...taskTimestampColumns,
  "(SELECT COUNT(*) FROM task_comments WHERE task_id = tasks.id) AS commentCount",
].join(", ");

export const createTask = (input: CreateTaskInput): TaskSummary => {
  ensureStateDatabase(input.statePath);
  const database = new DatabaseSync(input.statePath, { timeout: stateDatabaseTimeoutMs });

  try {
    database.exec("BEGIN IMMEDIATE");

    try {
      const numericId = nextTaskNumericId(database);
      const id = `${input.taskPrefix}-${numericId}`;

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
  } finally {
    database.close();
  }
};

export const listTasks = (input: ListTasksInput): readonly TaskSummary[] => {
  ensureStateDatabase(input.statePath);
  const database = new DatabaseSync(input.statePath, { timeout: stateDatabaseTimeoutMs });

  try {
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
  } finally {
    database.close();
  }
};

export const listActionableTasks = (statePath: string): readonly TaskSummary[] => {
  ensureStateDatabase(statePath);
  const database = new DatabaseSync(statePath, { timeout: stateDatabaseTimeoutMs });

  try {
    return database
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
  } finally {
    database.close();
  }
};

export const getTaskById = (statePath: string, taskId: PublicTaskId): TaskRecord | undefined => {
  ensureStateDatabase(statePath);
  const database = new DatabaseSync(statePath, { timeout: stateDatabaseTimeoutMs });

  try {
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
  } finally {
    database.close();
  }
};

export const getTaskContextById = (
  statePath: string,
  taskId: PublicTaskId,
): TaskContext | undefined => {
  ensureStateDatabase(statePath);
  const database = new DatabaseSync(statePath, { timeout: stateDatabaseTimeoutMs });

  try {
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
  } finally {
    database.close();
  }
};

export const appendTaskComment = (
  input: AppendTaskCommentInput,
): AppendTaskCommentResult | undefined => {
  ensureStateDatabase(input.statePath);
  const database = new DatabaseSync(input.statePath, { timeout: stateDatabaseTimeoutMs });

  try {
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
  } finally {
    database.close();
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
