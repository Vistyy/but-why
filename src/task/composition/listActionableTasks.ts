import type { Effect } from "effect";
import { listActionableTasksSqlite } from "../adapters/sqlite/sqliteTaskPersistence.js";
import type { TaskSummary } from "../task.js";
import { runTaskOperation, type TaskOperationError } from "./taskOperation.js";

export const listActionableTasks = (
  cwd: string,
): Effect.Effect<readonly TaskSummary[], TaskOperationError> =>
  runTaskOperation(cwd, (_context, repository) =>
    repository.transaction("list actionable Tasks", (sql) =>
      listActionableTasksSqlite(sql, repository.idPrefix),
    ),
  );
