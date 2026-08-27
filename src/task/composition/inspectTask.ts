import type { Effect } from "effect";
import {
  type RepositoryOperationError,
  type RepositoryOperationRuntime,
  runRepositoryOperation,
} from "../../repositoryRuntime/repositoryOperation.js";
import { getTaskById as getTaskByIdInSqlite } from "../adapters/sqlite/sqliteTaskPersistence.js";
import type { TaskRecord } from "../task.js";
import type { PublicTaskId } from "../taskId.js";

export const inspectTask = (
  runtime: RepositoryOperationRuntime,
  taskId: PublicTaskId,
): Effect.Effect<TaskRecord | undefined, RepositoryOperationError> =>
  runRepositoryOperation(runtime, (_context, repository) =>
    repository.transaction("read Task", (sql) =>
      getTaskByIdInSqlite(sql, taskId, repository.idPrefix),
    ),
  );
