import type { Effect } from "effect";
import {
  type RepositoryOperationError,
  runRepositoryOperationAt,
} from "../../repositoryRuntime/repositoryOperation.js";
import { createTaskSqlite } from "../adapters/sqlite/sqliteTaskPersistence.js";
import type { DependencyValidationCode, TaskContext, TaskRecord } from "../task.js";
import type { PublicTaskId } from "../taskId.js";
import type { CreateTaskInput } from "../taskStore.js";

export type CreateTaskResult =
  | { readonly ok: true; readonly task: TaskRecord; readonly context: TaskContext }
  | { readonly ok: false; readonly code: DependencyValidationCode; readonly taskId?: PublicTaskId };

export const createTask = (
  cwd: string,
  input: CreateTaskInput,
): Effect.Effect<CreateTaskResult, RepositoryOperationError> =>
  runRepositoryOperationAt(cwd, (_context, repository) =>
    repository.transactionImmediate("create Task", (sql) =>
      createTaskSqlite(sql, repository.idPrefix, input),
    ),
  );
