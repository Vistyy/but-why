import type { Effect } from "effect";
import {
  type RepositoryOperationError,
  type RepositoryOperationRuntime,
  runRepositoryOperation,
} from "../../repositoryRuntime/repositoryOperation.js";
import { listActionableTasksSqlite } from "../adapters/sqlite/sqliteTaskPersistence.js";
import type { TaskSummary } from "../task.js";

export const listActionableTasks = (
  runtime: RepositoryOperationRuntime,
): Effect.Effect<readonly TaskSummary[], RepositoryOperationError> =>
  runRepositoryOperation(runtime, (_context, repository) =>
    repository.transaction("list actionable Tasks", (sql) =>
      listActionableTasksSqlite(sql, repository.idPrefix),
    ),
  );
