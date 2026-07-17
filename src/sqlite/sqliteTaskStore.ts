import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { rollbackIfOpen, withStateDatabase, type SqliteStoreInput } from "./connection.js";
import { queryAll, queryOne } from "./query.js";
import { canTransition } from "../task/lifecycle.js";
import type { TaskContext, TaskSummary } from "../task/task.js";
import type { PublicTaskId } from "../task/taskId.js";
import type {
  AppendTaskCommentInput,
  AppendTaskCommentResult,
  CreateTaskInput,
  ListTasksInput,
  StoredTaskRecord,
  UpdateTaskContextInput,
  UpdateTaskContextResult,
  TaskStateTransitionResult,
  TaskStore,
} from "../task/taskStore.js";

export type SqliteTaskStoreInput = SqliteStoreInput & {
  readonly taskPrefix: string;
};

const taskTimestampColumns = ["created_at AS createdAt", "updated_at AS updatedAt"];
const taskSummaryColumns = ["id", "title", "state", ...taskTimestampColumns].join(", ");
const storedTaskRecordColumns = [
  "id",
  "title",
  "description",
  "state",
  ...taskTimestampColumns,
  "branch",
  "(SELECT COUNT(*) FROM task_comments WHERE task_id = tasks.id) AS commentCount",
].join(", ");

export const openSqliteTaskStore = (input: SqliteTaskStoreInput): TaskStore => ({
  createTask: (taskInput) =>
    withStateDatabase(input, (database) => createTask(database, input.taskPrefix, taskInput)),
  listTasks: (taskInput) => withStateDatabase(input, (database) => listTasks(database, taskInput)),
  listActionableTasks: () => withStateDatabase(input, listActionableTasks),
  getTaskById: (taskId) => withStateDatabase(input, (database) => getTaskById(database, taskId)),
  getTaskContextById: (taskId) =>
    withStateDatabase(input, (database) => getTaskContextById(database, taskId)),
  appendTaskComment: (taskInput) =>
    withStateDatabase(input, (database) => appendTaskComment(database, taskInput)),
  updateTaskContext: (taskInput) =>
    withStateDatabase(input, (database) => updateTaskContext(database, taskInput)),
  transitionTaskState: (taskInput) =>
    withStateDatabase(input, (database) => transitionTaskState(database, taskInput)),
});

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
    rollbackIfOpen(database);
    throw error;
  }
};

const listTasks = (database: DatabaseSync, input: ListTasksInput): readonly TaskSummary[] => {
  const rows = input.state
    ? queryAll<TaskSummaryRow>(
        database,
        `
          SELECT ${taskSummaryColumns}
          FROM tasks
          WHERE state = ?
          ORDER BY created_at ASC, numeric_id ASC
        `,
        [input.state],
      )
    : input.includeDone
      ? queryAll<TaskSummaryRow>(
          database,
          `
            SELECT ${taskSummaryColumns}
            FROM tasks
            ORDER BY created_at ASC, numeric_id ASC
          `,
        )
      : queryAll<TaskSummaryRow>(
          database,
          `
            SELECT ${taskSummaryColumns}
            FROM tasks
            WHERE state <> 'done'
            ORDER BY created_at ASC, numeric_id ASC
          `,
        );

  return rows.map(rowToTaskSummary);
};

const listActionableTasks = (database: DatabaseSync): readonly TaskSummary[] =>
  queryAll<TaskSummaryRow>(
    database,
    `
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
    `,
  ).map(rowToTaskSummary);

const getTaskById = (
  database: DatabaseSync,
  taskId: PublicTaskId,
): StoredTaskRecord | undefined => {
  const row = queryOne<StoredTaskRecordRow>(
    database,
    `
      SELECT ${storedTaskRecordColumns}
      FROM tasks
      WHERE id = ?
    `,
    [taskId],
  );

  if (row === undefined) {
    return undefined;
  }

  return rowToStoredTaskRecord(row);
};

const getTaskContextById = (
  database: DatabaseSync,
  taskId: PublicTaskId,
): TaskContext | undefined => {
  database.exec("BEGIN");

  try {
    const row = queryOne<TaskContextHeaderRow>(
      database,
      `
        SELECT id, title, description
        FROM tasks
        WHERE id = ?
      `,
      [taskId],
    );

    if (row === undefined) {
      database.exec("ROLLBACK");
      return undefined;
    }

    const task = rowToTaskContextHeader(row);
    const comments = queryAll<CommentContentRow>(
      database,
      `
        SELECT content
        FROM task_comments
        WHERE task_id = ?
        ORDER BY sequence ASC
      `,
      [taskId],
    ).map(rowToCommentContent);

    database.exec("COMMIT");
    return { ...task, comments };
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
    rollbackIfOpen(database);
    throw error;
  }
};

const updateTaskContext = (
  database: DatabaseSync,
  input: UpdateTaskContextInput,
): UpdateTaskContextResult => {
  database.exec("BEGIN IMMEDIATE");

  try {
    const current = getTaskById(database, input.taskId);

    if (current === undefined) {
      database.exec("ROLLBACK");
      return { ok: false, code: "task_not_found" };
    }

    if (current.state !== "todo") {
      database.exec("ROLLBACK");
      return { ok: false, code: "invalid_task_state", state: current.state };
    }

    database
      .prepare("UPDATE tasks SET title = ?, description = ?, updated_at = ? WHERE id = ?")
      .run(input.title, input.description, input.now, input.taskId);

    const updated = getTaskById(database, input.taskId);

    if (updated === undefined) {
      throw new Error("Task disappeared during Task Context update");
    }

    database.exec("COMMIT");
    return { ok: true, task: updated };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const transitionTaskState = (
  database: DatabaseSync,
  input: Parameters<TaskStore["transitionTaskState"]>[0],
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

    if (!canTransition(current.state, input.to)) {
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

const nextTaskNumericId = (database: DatabaseSync): number => {
  const row = queryOne<NumericIdRow>(
    database,
    "SELECT COALESCE(MAX(numeric_id), 0) + 1 AS numericId FROM tasks",
  );

  if (row === undefined) {
    throw new Error("Missing next task numeric ID");
  }

  return Number(row.numericId);
};

const rowToTaskSummary = (row: TaskSummaryRow): TaskSummary => ({
  id: row.id,
  title: row.title,
  state: row.state,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const rowToStoredTaskRecord = (row: StoredTaskRecordRow): StoredTaskRecord => ({
  ...rowToTaskSummary(row),
  description: row.description,
  branch: row.branch,
  commentCount: Number(row.commentCount),
});

const rowToTaskContextHeader = (row: TaskContextHeaderRow): Omit<TaskContext, "comments"> => ({
  id: row.id,
  title: row.title,
  description: row.description,
});

const rowToCommentContent = (row: CommentContentRow): string => row.content;

const commentCountForTask = (database: DatabaseSync, taskId: PublicTaskId): number => {
  const row = queryOne<CommentCountRow>(
    database,
    "SELECT COUNT(*) AS commentCount FROM task_comments WHERE task_id = ?",
    [taskId],
  );

  if (row === undefined) {
    throw new Error("Missing comment count");
  }

  return Number(row.commentCount);
};

type NumericIdRow = {
  readonly numericId: number | bigint;
};

type TaskSummaryRow = TaskSummary;

type StoredTaskRecordRow = TaskSummary & {
  readonly description: string;
  readonly branch: string | null;
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
