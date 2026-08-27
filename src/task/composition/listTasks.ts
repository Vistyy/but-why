import type { Effect } from "effect";
import {
  type RepositoryOperationError,
  type RepositoryOperationRuntime,
  runRepositoryOperation,
} from "../../repositoryRuntime/repositoryOperation.js";
import { listTasksSqlite } from "../adapters/sqlite/sqliteTaskPersistence.js";
import type { ListTasksInput, ListTasksResult } from "../taskStore.js";

export const listTasks = (
  runtime: RepositoryOperationRuntime,
  input: ListTasksInput,
): Effect.Effect<ListTasksResult, RepositoryOperationError> =>
  runRepositoryOperation(runtime, (_context, repository) =>
    repository.transaction("list Tasks", (sql) => listTasksSqlite(sql, repository.idPrefix, input)),
  );
