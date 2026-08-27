import type { Effect } from "effect";
import {
  type RepositoryOperationError,
  runRepositoryOperationAt,
} from "../../repositoryRuntime/repositoryOperation.js";
import { listActionableTasksSqlite } from "../adapters/sqlite/sqliteTaskPersistence.js";
import type { TaskSummary } from "../task.js";

export const listActionableTasks = (
  cwd: string,
): Effect.Effect<readonly TaskSummary[], RepositoryOperationError> =>
  runRepositoryOperationAt(cwd, (_context, repository) =>
    repository.transaction("list actionable Tasks", (sql) =>
      listActionableTasksSqlite(sql, repository.idPrefix),
    ),
  );
