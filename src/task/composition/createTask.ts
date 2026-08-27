import type { Effect } from "effect";
import { createTaskSqlite } from "../adapters/sqlite/sqliteTaskPersistence.js";
import type { DependencyValidationCode, TaskContext, TaskRecord } from "../task.js";
import type { PublicTaskId } from "../taskId.js";
import type { CreateTaskInput } from "../taskStore.js";
import { runTaskOperation, type TaskOperationError } from "./taskOperation.js";

export type CreateTaskResult =
  | { readonly ok: true; readonly task: TaskRecord; readonly context: TaskContext }
  | { readonly ok: false; readonly code: DependencyValidationCode; readonly taskId?: PublicTaskId };

export const createTask = (
  cwd: string,
  input: CreateTaskInput,
): Effect.Effect<CreateTaskResult, TaskOperationError> =>
  runTaskOperation(cwd, (_context, repository) =>
    repository.transactionImmediate("create Task", (sql) =>
      createTaskSqlite(sql, repository.idPrefix, input),
    ),
  );
