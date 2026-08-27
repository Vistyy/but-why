import type { Effect } from "effect";
import { getTaskById as getTaskByIdInSqlite } from "../adapters/sqlite/sqliteTaskPersistence.js";
import type { TaskRecord } from "../task.js";
import type { PublicTaskId } from "../taskId.js";
import { runTaskOperation, type TaskOperationError } from "./taskOperation.js";

export const inspectTask = (
  cwd: string,
  taskId: PublicTaskId,
): Effect.Effect<TaskRecord | undefined, TaskOperationError> =>
  runTaskOperation(cwd, (_context, repository) =>
    repository.transaction("read Task", (sql) =>
      getTaskByIdInSqlite(sql, taskId, repository.idPrefix),
    ),
  );
