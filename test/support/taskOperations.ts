import { Effect } from "effect";
import { RepositorySql } from "../../src/repositoryRuntime/adapters/sqlite/repositorySql.js";
import {
  cancelTask,
  createTaskSqlite,
  getTaskById,
  getTaskContextById,
  listActionableTasksSqlite,
  listTasksSqlite,
  updateTaskContext,
} from "../../src/task/adapters/sqlite/sqliteTaskPersistence.js";
import type { PublicTaskId } from "../../src/task/taskId.js";
import type {
  CancelTaskInput,
  CreateTaskInput,
  ListTasksInput,
  UpdateTaskContextInput,
} from "../../src/task/taskStore.js";

export const createTaskInSqlite = (input: CreateTaskInput) =>
  Effect.flatMap(RepositorySql, (repository) =>
    repository.transactionImmediate("create Task", (sql) =>
      createTaskSqlite(sql, repository.idPrefix, input),
    ),
  );

export const listTasksInSqlite = (input: ListTasksInput) =>
  Effect.flatMap(RepositorySql, (repository) =>
    repository.transaction("list Tasks", (sql) => listTasksSqlite(sql, repository.idPrefix, input)),
  );

export const listActionableTasksInSqlite = () =>
  Effect.flatMap(RepositorySql, (repository) =>
    repository.transaction("list actionable Tasks", (sql) =>
      listActionableTasksSqlite(sql, repository.idPrefix),
    ),
  );

export const getTaskInSqlite = (taskId: PublicTaskId) =>
  Effect.flatMap(RepositorySql, (repository) =>
    repository.transaction("read Task", (sql) => getTaskById(sql, taskId, repository.idPrefix)),
  );

export const getTaskContextInSqlite = (taskId: PublicTaskId) =>
  Effect.flatMap(RepositorySql, (repository) =>
    repository.transaction("read Task Context", (sql) =>
      getTaskContextById(sql, taskId, repository.idPrefix),
    ),
  );

export const updateTaskContextInSqlite = (input: UpdateTaskContextInput) =>
  Effect.flatMap(RepositorySql, (repository) =>
    repository.transactionImmediate("update Task Context", (sql) =>
      updateTaskContext(sql, repository.idPrefix, input),
    ),
  );

export const cancelTaskInSqlite = (input: CancelTaskInput) =>
  Effect.flatMap(RepositorySql, (repository) =>
    repository.transactionImmediate("cancel Task", (sql) =>
      cancelTask(sql, input, repository.idPrefix),
    ),
  );
