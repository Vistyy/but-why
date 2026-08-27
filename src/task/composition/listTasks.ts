import type { Effect } from "effect";
import {
  type RepositoryOperationError,
  runRepositoryOperationAt,
} from "../../repositoryRuntime/repositoryOperation.js";
import { listTasksSqlite } from "../adapters/sqlite/sqliteTaskPersistence.js";
import type { ListTasksInput, ListTasksResult } from "../taskStore.js";

export const listTasks = (
  cwd: string,
  input: ListTasksInput,
): Effect.Effect<ListTasksResult, RepositoryOperationError> =>
  runRepositoryOperationAt(cwd, (_context, repository) =>
    repository.transaction("list Tasks", (sql) => listTasksSqlite(sql, repository.idPrefix, input)),
  );
