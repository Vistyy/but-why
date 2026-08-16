import { Effect } from "effect";

import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { ResolveLocalRepositoryError } from "../../repositoryRuntime/repositoryContext.js";
import { openRepositoryRuntime } from "../../repositoryRuntime/repositoryRuntime.js";
import { openSqliteActiveValidationRunPort } from "../../sqlite/sqliteActiveValidationRunPersistence.js";
import { openSqliteChangeAuthorityPort } from "../../sqlite/sqliteChangeAuthorityPersistence.js";
import { openSqliteChangeReadPort } from "../../sqlite/sqliteChangeInspectionPersistence.js";
import { openSqliteTaskChangeLinkPort } from "../adapters/sqlite/sqliteTaskChangePersistence.js";
import { queryTaskChangeProjection, type TaskChangeProjection } from "../inspectTaskChange.js";

export type LoadTaskChangeInspectionError = ResolveLocalRepositoryError;

export type LoadedTaskChangeInspection<A> =
  | { readonly ok: true; readonly commonDirectory: string; readonly operation: A }
  | { readonly ok: false; readonly error: LoadTaskChangeInspectionError };

type LoadInput = { readonly cwd: string };

export const loadTaskChangeProjection = (
  input: LoadInput,
): LoadedTaskChangeInspection<
  (taskId: string) => Effect.Effect<TaskChangeProjection | null, RepositoryStorageError>
> => {
  const loaded = openRepositoryRuntime(input.cwd);
  if (!loaded.ok) return loaded;
  return {
    ok: true,
    commonDirectory: loaded.runtime.context.commonDirectory,
    operation: (taskId) =>
      loaded.runtime.provide(
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
  };
};
