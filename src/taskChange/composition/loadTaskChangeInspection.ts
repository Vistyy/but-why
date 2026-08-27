import type { Effect } from "effect";
import {
  type RepositoryOperationError,
  runRepositoryOperationAt,
} from "../../repositoryRuntime/repositoryOperation.js";
import type { TaskChangeProjection } from "../inspectTaskChange.js";
import { listTaskChangeProjectionsSqlite } from "./taskChangeInspectionPersistence.js";

export const listTaskChangeProjections = (
  cwd: string,
  taskIds: readonly string[],
): Effect.Effect<ReadonlyMap<string, TaskChangeProjection | null>, RepositoryOperationError> =>
  runRepositoryOperationAt(cwd, (_context, repository) =>
    repository.transaction("list Task Change projections", (sql) =>
      listTaskChangeProjectionsSqlite(sql, taskIds, repository.idPrefix),
    ),
  );
