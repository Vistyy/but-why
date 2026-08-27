import type { Effect } from "effect";
import {
  type RepositoryOperationError,
  runRepositoryOperationAt,
} from "../../repositoryRuntime/repositoryOperation.js";
import { getTaskById as getTaskByIdInSqlite } from "../adapters/sqlite/sqliteTaskPersistence.js";
import type { TaskRecord } from "../task.js";
import type { PublicTaskId } from "../taskId.js";

export const inspectTask = (
  cwd: string,
  taskId: PublicTaskId,
): Effect.Effect<TaskRecord | undefined, RepositoryOperationError> =>
  runRepositoryOperationAt(cwd, (_context, repository) =>
    repository.transaction("read Task", (sql) =>
      getTaskByIdInSqlite(sql, taskId, repository.idPrefix),
    ),
  );
