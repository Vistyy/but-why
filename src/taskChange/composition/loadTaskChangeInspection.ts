import { Effect } from "effect";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import { RepositorySql } from "../../repositoryRuntime/adapters/sqlite/repositorySql.js";
import type { RepositoryOperationRuntime } from "../../repositoryRuntime/repositoryOperation.js";
import type { TaskChangeProjection } from "../inspectTaskChange.js";
import { listTaskChangeProjectionsSqlite } from "./taskChangeInspectionPersistence.js";

export type LoadedTaskChangeInspection<A> = {
  readonly ok: true;
  readonly commonDirectory: string;
  readonly operation: A;
};

export const loadTaskChangeProjections = (
  runtime: RepositoryOperationRuntime,
): LoadedTaskChangeInspection<
  (
    taskIds: readonly string[],
  ) => Effect.Effect<ReadonlyMap<string, TaskChangeProjection | null>, RepositoryStorageError>
> => ({
  ok: true,
  commonDirectory: runtime.context.commonDirectory,
  operation: (taskIds) =>
    runtime.provide(
      Effect.flatMap(RepositorySql, (repository) =>
        repository.transaction("list Task Change projections", (sql) =>
          listTaskChangeProjectionsSqlite(sql, taskIds, repository.idPrefix),
        ),
      ),
    ),
});
