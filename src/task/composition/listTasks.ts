import type { Effect } from "effect";
import { listTasksSqlite } from "../adapters/sqlite/sqliteTaskPersistence.js";
import type { ListTasksInput, ListTasksResult } from "../taskStore.js";
import { runTaskOperation, type TaskOperationError } from "./taskOperation.js";

export const listTasks = (
  cwd: string,
  input: ListTasksInput,
): Effect.Effect<ListTasksResult, TaskOperationError> =>
  runTaskOperation(cwd, (_context, repository) =>
    repository.transaction("list Tasks", (sql) => listTasksSqlite(sql, repository.idPrefix, input)),
  );
