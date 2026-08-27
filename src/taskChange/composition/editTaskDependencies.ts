import { Effect } from "effect";
import {
  editTaskDependenciesSqlite,
  validateTaskDependencyEditTarget,
} from "../../task/adapters/sqlite/sqliteTaskPersistence.js";
import type {
  EditTaskDependenciesInput,
  EditTaskDependenciesResult,
} from "../../task/taskStore.js";
import { readTaskChangeLinkByTaskId } from "../adapters/sqlite/sqliteTaskChangePersistence.js";
import { runTaskChangeOperation, type TaskChangeOperationError } from "./taskChangeOperation.js";

export const editTaskDependencies = (
  cwd: string,
  input: EditTaskDependenciesInput,
): Effect.Effect<EditTaskDependenciesResult, TaskChangeOperationError> =>
  runTaskChangeOperation(cwd, (_context, repository) =>
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
