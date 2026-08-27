import { Effect } from "effect";
import { openSqliteActiveValidationRunPort } from "../../change/adapters/sqlite/sqliteActiveValidationRunPersistence.js";
import { openSqliteChangeAuthorityPort } from "../../change/adapters/sqlite/sqliteChangeAuthorityPersistence.js";
import { openSqliteChangeReadPort } from "../../change/adapters/sqlite/sqliteChangeInspectionPersistence.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import { RepositorySql } from "../../repositoryRuntime/adapters/sqlite/repositorySql.js";
import type { RepositoryOperationRuntime } from "../../repositoryRuntime/repositoryOperation.js";
import { openSqliteTaskChangeLinkPort } from "../adapters/sqlite/sqliteTaskChangePersistence.js";
import { queryTaskChangeProjection, type TaskChangeProjection } from "../inspectTaskChange.js";
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

export const loadTaskChangeProjection = (
  runtime: RepositoryOperationRuntime,
): LoadedTaskChangeInspection<
  (taskId: string) => Effect.Effect<TaskChangeProjection | null, RepositoryStorageError>
> => ({
  ok: true,
  commonDirectory: runtime.context.commonDirectory,
  operation: (taskId) =>
    runtime.provide(
      Effect.all({
        links: openSqliteTaskChangeLinkPort(),
        changes: openSqliteChangeReadPort(),
        authority: openSqliteChangeAuthorityPort(),
        activeValidation: openSqliteActiveValidationRunPort(),
      }).pipe(
        Effect.flatMap(({ links, changes, authority, activeValidation }) =>
          queryTaskChangeProjection({ links, changes, authority, activeValidation }, taskId),
        ),
      ),
    ),
});
