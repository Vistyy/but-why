import type { Effect } from "effect";
import {
  type RepositoryOperationError,
  type RepositoryOperationRuntime,
  runRepositoryOperation,
} from "../../repositoryRuntime/repositoryOperation.js";
import { createTaskSqlite } from "../adapters/sqlite/sqliteTaskPersistence.js";
import type { DependencyValidationCode, TaskContext, TaskRecord } from "../task.js";
import type { PublicTaskId } from "../taskId.js";
import type { CreateTaskInput } from "../taskStore.js";

export type CreateTaskResult =
  | { readonly ok: true; readonly task: TaskRecord; readonly context: TaskContext }
  | { readonly ok: false; readonly code: DependencyValidationCode; readonly taskId?: PublicTaskId };

export const createTask = (
  runtime: RepositoryOperationRuntime,
  input: CreateTaskInput,
): Effect.Effect<CreateTaskResult, RepositoryOperationError> =>
  runRepositoryOperation(runtime, (_context, repository) =>
    repository.transactionImmediate("create Task", (sql) =>
      createTaskSqlite(sql, repository.idPrefix, input),
    ),
  );
