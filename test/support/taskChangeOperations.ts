import { Effect } from "effect";
import { RepositorySql } from "../../src/repositoryRuntime/adapters/sqlite/repositorySql.js";
import {
  editTaskDependenciesSqlite,
  getTaskById,
  renameTaskSqlite,
  reviseTaskSqlite,
  validateTaskDependencyEditTarget,
  validateTaskRevisionTarget,
} from "../../src/task/adapters/sqlite/sqliteTaskPersistence.js";
import { normalizeTaskTitle } from "../../src/task/taskTitle.js";
import { readTaskChangeLinkByTaskId } from "../../src/taskChange/adapters/sqlite/sqliteTaskChangePersistence.js";

export const editTaskDependenciesForTaskChange = (
  input: Parameters<typeof editTaskDependenciesSqlite>[1],
) =>
  Effect.flatMap(RepositorySql, (repository) =>
    repository.transactionImmediate("edit Task dependencies", (sql) =>
      Effect.gen(function* () {
        const target = yield* validateTaskDependencyEditTarget(
          sql,
          input.taskId,
          repository.idPrefix,
        );
        if (!target.ok) return target;
        const link = yield* readTaskChangeLinkByTaskId(sql, input.taskId, repository.idPrefix);
        if (link !== undefined) {
          return {
            ok: false as const,
            code: "dependencies_locked" as const,
            state: target.task.state,
          };
        }
        return yield* editTaskDependenciesSqlite(sql, input, repository.idPrefix);
      }),
    ),
  );

export const renameTaskForTaskChange = (input: Parameters<typeof renameTaskSqlite>[1]) =>
  Effect.flatMap(RepositorySql, (repository) =>
    repository.transactionImmediate("rename Task", (sql) =>
      Effect.gen(function* () {
        const title = normalizeTaskTitle(input.title);
        if (!title.ok) return title;
        const current = yield* getTaskById(sql, input.taskId, repository.idPrefix);
        if (current === undefined) return { ok: false as const, code: "task_not_found" as const };
        if (current.title === title.title) return { ok: true as const, noOp: true, task: current };
        const link = yield* readTaskChangeLinkByTaskId(sql, input.taskId, repository.idPrefix);
        if (link !== undefined) {
          return {
            ok: false as const,
            code: "task_change_linked" as const,
            changeId: link.changeId,
          };
        }
        return yield* renameTaskSqlite(sql, { ...input, title: title.title }, repository.idPrefix);
      }),
    ),
  );

export const reviseTaskForTaskChange = (input: Parameters<typeof reviseTaskSqlite>[1]) =>
  Effect.flatMap(RepositorySql, (repository) =>
    repository.transactionImmediate("revise Task", (sql) =>
      Effect.gen(function* () {
        const current = yield* validateTaskRevisionTarget(sql, input.taskId, repository.idPrefix);
        if (!current.ok) return current;
        const link = yield* readTaskChangeLinkByTaskId(sql, input.taskId, repository.idPrefix);
        if (link !== undefined) {
          return {
            ok: false as const,
            code: "task_change_linked" as const,
            changeId: link.changeId,
          };
        }
        return yield* reviseTaskSqlite(sql, input, repository.idPrefix);
      }),
    ),
  );
