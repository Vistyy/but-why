import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { TaskDependencyFact } from "../task/task.js";
import { storedPublicTaskId, type PublicTaskId } from "../task/taskId.js";
import type { TaskState } from "../task/lifecycle.js";
import type { TaskContextSnapshotV1 } from "../validationRun/taskContextSnapshot.js";
import type { TaskStartRecord } from "../taskStart/taskStart.js";
import type {
  BindTaskStartInput,
  BindTaskStartResult,
  TaskStartStore,
} from "../taskStart/taskStartStore.js";
import { rollbackIfOpen, withStateDatabase, type SqliteStoreInput } from "./connection.js";
import { queryAll, queryOne } from "./query.js";

const columns = [
  "task_id AS taskId",
  "change_id AS changeId",
  "branch_ref AS branchRef",
  "base_ref AS baseRef",
  "starting_commit AS startingCommit",
  "worktree_path AS worktreePath",
  "acceptance_context AS acceptanceContext",
  "provisioning_state AS provisioningState",
  "created_at AS createdAt",
  "updated_at AS updatedAt",
].join(", ");

export const openSqliteTaskStartStore = (input: SqliteStoreInput): TaskStartStore => ({
  prepare: (taskId) => withStateDatabase(input, (database) => prepare(database, taskId)),
  getByTaskId: (taskId) => withStateDatabase(input, (database) => getByTaskId(database, taskId)),
  bind: (bindInput) => withStateDatabase(input, (database) => bind(database, bindInput)),
  markReady: (taskId, now) =>
    withStateDatabase(input, (database) => markReady(database, taskId, now)),
});

const prepare = (
  database: DatabaseSync,
  taskId: PublicTaskId,
): ReturnType<TaskStartStore["prepare"]> => {
  const existing = getByTaskId(database, taskId);
  if (existing !== undefined) return { ok: true, existing };
  const eligibility = readEligibility(database, taskId);
  return eligibility.ok ? { ok: true, existing: undefined } : eligibility;
};

const bind = (database: DatabaseSync, input: BindTaskStartInput): BindTaskStartResult => {
  database.exec("BEGIN IMMEDIATE");

  try {
    const existing = getByTaskId(database, input.taskId);
    if (existing !== undefined) {
      database.exec("COMMIT");
      return matchesIntent(existing, input)
        ? { ok: true, changed: false, start: existing }
        : { ok: false, code: "task_start_conflict" };
    }

    const eligibility = readEligibility(database, input.taskId);
    if (!eligibility.ok) {
      database.exec("ROLLBACK");
      return eligibility;
    }
    const task = eligibility.task;

    const comments = queryAll<{ readonly content: string }>(
      database,
      "SELECT content FROM task_comments WHERE task_id = ? ORDER BY sequence ASC",
      [input.taskId],
    ).map((row) => row.content);
    const acceptanceContext: TaskContextSnapshotV1 = {
      version: 1,
      title: task.title,
      description: task.description,
      comments,
    };
    const changeId = randomUUID();

    database
      .prepare(`
        INSERT INTO changes (
          id, repository_common_directory, branch_ref, base_ref, task_id, state,
          close_reason, created_at, updated_at, closed_at
        ) VALUES (?, ?, ?, ?, ?, 'open', NULL, ?, ?, NULL)
      `)
      .run(
        changeId,
        input.repositoryCommonDirectory,
        input.branchRef,
        input.baseRef,
        input.taskId,
        input.now,
        input.now,
      );
    database
      .prepare(`
        INSERT INTO task_starts (
          task_id, change_id, branch_ref, base_ref, starting_commit, worktree_path,
          acceptance_context, provisioning_state, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `)
      .run(
        input.taskId,
        changeId,
        input.branchRef,
        input.baseRef,
        input.startingCommit,
        input.worktreePath,
        JSON.stringify(acceptanceContext),
        input.now,
        input.now,
      );
    database
      .prepare("UPDATE tasks SET state = 'implementing', updated_at = ? WHERE id = ?")
      .run(input.now, input.taskId);

    const created = getByTaskId(database, input.taskId);
    if (created === undefined) throw new Error("Task Start disappeared during creation");
    database.exec("COMMIT");
    return { ok: true, changed: true, start: created };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const readEligibility = (
  database: DatabaseSync,
  taskId: PublicTaskId,
):
  | { readonly ok: true; readonly task: TaskRow }
  | Exclude<ReturnType<TaskStartStore["prepare"]>, { readonly ok: true }> => {
  const task = queryOne<TaskRow>(
    database,
    "SELECT id, title, description, state FROM tasks WHERE id = ?",
    [taskId],
  );
  if (task === undefined) return { ok: false, code: "task_not_found" };
  if (task.state !== "todo") {
    return { ok: false, code: "invalid_task_state", state: task.state };
  }
  const blockedBy = queryAll<TaskDependencyFact>(
    database,
    `
      SELECT tasks.id, tasks.title, tasks.state
      FROM task_dependencies
      JOIN tasks ON tasks.id = task_dependencies.prerequisite_task_id
      WHERE task_dependencies.dependent_task_id = ? AND tasks.state <> 'done'
      ORDER BY tasks.numeric_id ASC
    `,
    [taskId],
  );
  return blockedBy.length === 0
    ? { ok: true, task }
    : { ok: false, code: "task_dependencies_unsatisfied", blockedBy };
};

const markReady = (database: DatabaseSync, taskId: PublicTaskId, now: string): TaskStartRecord => {
  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(
        "UPDATE task_starts SET provisioning_state = 'ready', updated_at = ? WHERE task_id = ?",
      )
      .run(now, taskId);
    const start = getByTaskId(database, taskId);
    if (start === undefined) throw new Error("Task Start was not found while marking it ready");
    database.exec("COMMIT");
    return start;
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const getByTaskId = (database: DatabaseSync, taskId: PublicTaskId): TaskStartRecord | undefined => {
  const row = queryOne<TaskStartRow>(
    database,
    `SELECT ${columns} FROM task_starts WHERE task_id = ?`,
    [taskId],
  );
  if (row === undefined) return undefined;
  return {
    ...row,
    taskId: storedPublicTaskId(row.taskId),
    acceptanceContext: parseAcceptanceContext(row.acceptanceContext),
  };
};

const parseAcceptanceContext = (source: string): TaskContextSnapshotV1 => {
  const value = JSON.parse(source) as Partial<TaskContextSnapshotV1>;
  if (
    value.version !== 1 ||
    typeof value.title !== "string" ||
    typeof value.description !== "string" ||
    !Array.isArray(value.comments) ||
    !value.comments.every((comment) => typeof comment === "string")
  ) {
    throw new Error("Invalid stored Acceptance Context");
  }
  return value as TaskContextSnapshotV1;
};

const matchesIntent = (start: TaskStartRecord, input: BindTaskStartInput): boolean =>
  start.branchRef === input.branchRef &&
  start.baseRef === input.baseRef &&
  start.startingCommit === input.startingCommit &&
  start.worktreePath === input.worktreePath;

type TaskRow = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly state: TaskState;
};

type TaskStartRow = Omit<TaskStartRecord, "taskId" | "acceptanceContext"> & {
  readonly taskId: string;
  readonly acceptanceContext: string;
};
