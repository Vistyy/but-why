import { randomUUID } from "node:crypto";
import type { SqliteDatabase } from "./connection.js";

import { rollbackIfOpen, withStateDatabase, type SqliteStoreInput } from "./connection.js";
import { queryAll, queryOne } from "./query.js";
import { canTransition } from "../task/lifecycle.js";
import {
  TaskDependencyValidationError,
  type TaskContext,
  type TaskDependencyFact,
  type TaskSummary,
} from "../task/task.js";
import { generatedPublicTaskId, type PublicTaskId } from "../task/taskId.js";
import type {
  AppendTaskCommentInput,
  AppendTaskCommentResult,
  ApproveTaskInput,
  CreateTaskInput,
  ListTasksInput,
  StoredTaskRecord,
  UpdateTaskContextInput,
  UpdateTaskContextResult,
  TaskApprovalResult,
  TaskStateTransitionResult,
  TaskStore,
  ReplaceTaskDependenciesInput,
  ReplaceTaskDependenciesResult,
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
  "(SELECT COUNT(*) FROM task_comments WHERE task_id = tasks.id) AS commentCount",
].join(", ");

export const openSqliteTaskStore = (input: SqliteTaskStoreInput): TaskStore => ({
  createTask: (taskInput) =>
    withStateDatabase(input, (database) => createTask(database, input.taskPrefix, taskInput)),
  replaceTaskDependencies: (taskInput) =>
    withStateDatabase(input, (database) => replaceTaskDependencies(database, taskInput)),
  listTasks: (taskInput) => withStateDatabase(input, (database) => listTasks(database, taskInput)),
  listActionableTasks: () => withStateDatabase(input, listActionableTasks),
  getTaskById: (taskId) => withStateDatabase(input, (database) => getTaskById(database, taskId)),
  getTaskContextById: (taskId) =>
    withStateDatabase(input, (database) => getTaskContextById(database, taskId)),
  approveTask: (taskInput) =>
    withStateDatabase(input, (database) => approveTask(database, taskInput)),
  appendTaskComment: (taskInput) =>
    withStateDatabase(input, (database) => appendTaskComment(database, taskInput)),
  updateTaskContext: (taskInput) =>
    withStateDatabase(input, (database) => updateTaskContext(database, taskInput)),
  transitionTaskState: (taskInput) =>
    withStateDatabase(input, (database) => transitionTaskState(database, taskInput)),
});

const createTask = (
  database: SqliteDatabase,
  taskPrefix: string,
  input: CreateTaskInput,
): TaskSummary => {
  database.exec("BEGIN IMMEDIATE");

  try {
    const numericId = nextTaskNumericId(database);
    const taskId = generatedPublicTaskId(taskPrefix, numericId);
    const id = taskId;
    const prerequisiteTaskIds = input.dependsOn ?? [];
    validateDependencies(database, taskId, prerequisiteTaskIds, false);

    database
      .prepare(`
        INSERT INTO tasks (id, numeric_id, title, description, state, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(id, numericId, input.title, input.description, "new", input.now, input.now);

    insertDependencies(database, taskId, prerequisiteTaskIds);
    const created = getTaskById(database, taskId);

    if (created === undefined) {
      throw new Error("Task disappeared during creation");
    }

    database.exec("COMMIT");
    return created;
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const replaceTaskDependencies = (
  database: SqliteDatabase,
  input: ReplaceTaskDependenciesInput,
): ReplaceTaskDependenciesResult => {
  database.exec("BEGIN IMMEDIATE");

  try {
    const current = getTaskById(database, input.taskId);

    if (current === undefined) {
      database.exec("ROLLBACK");
      return { ok: false, code: "task_not_found" };
    }

    if (current.state !== "new" && current.state !== "todo") {
      database.exec("ROLLBACK");
      return { ok: false, code: "dependencies_locked", state: current.state };
    }

    try {
      validateDependencies(database, input.taskId, input.prerequisiteTaskIds, true);
    } catch (error) {
      if (error instanceof TaskDependencyValidationError) {
        database.exec("ROLLBACK");
        return { ok: false, code: error.code, ...(error.taskId ? { taskId: error.taskId } : {}) };
      }
      throw error;
    }

    database.prepare("DELETE FROM task_dependencies WHERE dependent_task_id = ?").run(input.taskId);
    insertDependencies(database, input.taskId, input.prerequisiteTaskIds);

    const updated = getTaskById(database, input.taskId);
    if (updated === undefined) throw new Error("Task disappeared during dependency replacement");

    database.exec("COMMIT");
    return { ok: true, task: updated };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const listTasks = (database: SqliteDatabase, input: ListTasksInput): readonly TaskSummary[] => {
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

  return rows.map((row) => rowToTaskSummary(database, row));
};

const listActionableTasks = (database: SqliteDatabase): readonly TaskSummary[] =>
  queryAll<TaskSummaryRow>(
    database,
    `
      SELECT ${taskSummaryColumns}
      FROM tasks
      WHERE state IN ('new', 'todo', 'ready')
      ORDER BY
        CASE state
          WHEN 'ready' THEN 0
          WHEN 'new' THEN 1
          WHEN 'todo' THEN 2
        END ASC,
        updated_at DESC,
        numeric_id ASC
    `,
  ).map((row) => rowToTaskSummary(database, row));

const getTaskById = (
  database: SqliteDatabase,
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

  return rowToStoredTaskRecord(database, row);
};

const getTaskContextById = (
  database: SqliteDatabase,
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

const approveTask = (database: SqliteDatabase, input: ApproveTaskInput): TaskApprovalResult => {
  database.exec("BEGIN IMMEDIATE");

  try {
    const current = getTaskById(database, input.taskId);

    if (current === undefined) {
      database.exec("ROLLBACK");
      return { ok: false, code: "task_not_found" };
    }

    if (current.state === "todo") {
      database.exec("COMMIT");
      return { ok: true, changed: false, task: current };
    }

    if (current.state !== "new") {
      database.exec("ROLLBACK");
      return { ok: false, code: "invalid_task_state", state: current.state };
    }

    database
      .prepare("UPDATE tasks SET state = 'todo', updated_at = ? WHERE id = ?")
      .run(input.now, input.taskId);

    const updated = getTaskById(database, input.taskId);

    if (updated === undefined) {
      throw new Error("Task disappeared during approval");
    }

    database.exec("COMMIT");
    return { ok: true, changed: true, task: updated };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const appendTaskComment = (
  database: SqliteDatabase,
  input: AppendTaskCommentInput,
): AppendTaskCommentResult => {
  database.exec("BEGIN IMMEDIATE");

  try {
    const task = getTaskById(database, input.taskId);

    if (task === undefined) {
      database.exec("ROLLBACK");
      return { ok: false, code: "task_not_found" };
    }

    if (task.state !== "new" && task.state !== "todo") {
      database.exec("ROLLBACK");
      return { ok: false, code: "invalid_task_state", state: task.state };
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

    return { ok: true, taskId: input.taskId, commentCount: count };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const updateTaskContext = (
  database: SqliteDatabase,
  input: UpdateTaskContextInput,
): UpdateTaskContextResult => {
  database.exec("BEGIN IMMEDIATE");

  try {
    const current = getTaskById(database, input.taskId);

    if (current === undefined) {
      database.exec("ROLLBACK");
      return { ok: false, code: "task_not_found" };
    }

    if (current.state !== "new" && current.state !== "todo") {
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
  database: SqliteDatabase,
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

    if (input.to === "implementing") {
      const blockedBy = dependencyFacts(database, input.taskId, "prerequisites").filter(
        (dependency) => dependency.state !== "done",
      );
      if (blockedBy.length > 0) {
        database.exec("ROLLBACK");
        return { ok: false, code: "task_dependencies_unsatisfied", blockedBy };
      }
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

const validateDependencies = (
  database: SqliteDatabase,
  dependentTaskId: PublicTaskId,
  prerequisiteTaskIds: readonly PublicTaskId[],
  dependentExists: boolean,
): void => {
  const seen = new Set<string>();

  for (const prerequisiteTaskId of prerequisiteTaskIds) {
    if (seen.has(prerequisiteTaskId)) {
      throw new TaskDependencyValidationError("dependency_duplicate", prerequisiteTaskId);
    }
    seen.add(prerequisiteTaskId);

    if (prerequisiteTaskId === dependentTaskId) {
      throw new TaskDependencyValidationError("dependency_self", prerequisiteTaskId);
    }

    if (getTaskById(database, prerequisiteTaskId) === undefined) {
      throw new TaskDependencyValidationError("dependency_unknown_task", prerequisiteTaskId);
    }

    if (dependentExists && dependencyPathExists(database, prerequisiteTaskId, dependentTaskId)) {
      throw new TaskDependencyValidationError("dependency_cycle");
    }
  }
};

const dependencyPathExists = (
  database: SqliteDatabase,
  fromTaskId: PublicTaskId,
  targetTaskId: PublicTaskId,
): boolean =>
  queryOne<{ readonly found: number }>(
    database,
    `
      WITH RECURSIVE prerequisites(task_id) AS (
        SELECT ?
        UNION
        SELECT task_dependencies.prerequisite_task_id
        FROM task_dependencies
        JOIN prerequisites
          ON task_dependencies.dependent_task_id = prerequisites.task_id
      )
      SELECT 1 AS found FROM prerequisites WHERE task_id = ? LIMIT 1
    `,
    [fromTaskId, targetTaskId],
  ) !== undefined;

const insertDependencies = (
  database: SqliteDatabase,
  dependentTaskId: PublicTaskId,
  prerequisiteTaskIds: readonly PublicTaskId[],
): void => {
  const insert = database.prepare(`
    INSERT INTO task_dependencies (dependent_task_id, prerequisite_task_id)
    VALUES (?, ?)
  `);
  for (const prerequisiteTaskId of prerequisiteTaskIds) {
    insert.run(dependentTaskId, prerequisiteTaskId);
  }
};

const dependencyFacts = (
  database: SqliteDatabase,
  taskId: string,
  direction: "prerequisites" | "dependents",
): readonly TaskDependencyFact[] =>
  direction === "prerequisites"
    ? queryAll<TaskDependencyFact>(
        database,
        `
          SELECT tasks.id, tasks.title, tasks.state
          FROM task_dependencies
          JOIN tasks ON tasks.id = task_dependencies.prerequisite_task_id
          WHERE task_dependencies.dependent_task_id = ?
          ORDER BY tasks.numeric_id ASC
        `,
        [taskId],
      )
    : queryAll<TaskDependencyFact>(
        database,
        `
          SELECT tasks.id, tasks.title, tasks.state
          FROM task_dependencies
          JOIN tasks ON tasks.id = task_dependencies.dependent_task_id
          WHERE task_dependencies.prerequisite_task_id = ?
          ORDER BY tasks.numeric_id ASC
        `,
        [taskId],
      );

const nextTaskNumericId = (database: SqliteDatabase): number => {
  const row = queryOne<NumericIdRow>(
    database,
    "SELECT COALESCE(MAX(numeric_id), 0) + 1 AS numericId FROM tasks",
  );

  if (row === undefined) {
    throw new Error("Missing next task numeric ID");
  }

  return Number(row.numericId);
};

const rowToTaskSummary = (database: SqliteDatabase, row: TaskSummaryRow): TaskSummary => {
  const blockedBy = dependencyFacts(database, row.id, "prerequisites").filter(
    (dependency) => dependency.state !== "done",
  );

  return {
    id: row.id,
    title: row.title,
    state: row.state,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startable: row.state === "todo" && blockedBy.length === 0,
    blockedBy,
  };
};

const rowToStoredTaskRecord = (
  database: SqliteDatabase,
  row: StoredTaskRecordRow,
): StoredTaskRecord => ({
  ...rowToTaskSummary(database, row),
  description: row.description,
  commentCount: Number(row.commentCount),
  prerequisites: dependencyFacts(database, row.id, "prerequisites"),
  dependents: dependencyFacts(database, row.id, "dependents"),
});

const rowToTaskContextHeader = (row: TaskContextHeaderRow): Omit<TaskContext, "comments"> => ({
  id: row.id,
  title: row.title,
  description: row.description,
});

const rowToCommentContent = (row: CommentContentRow): string => row.content;

const commentCountForTask = (database: SqliteDatabase, taskId: PublicTaskId): number => {
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
