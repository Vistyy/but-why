import { Effect } from "effect";

import type { ResolveLocalRepositoryError } from "../../repositoryRuntime/repositoryContext.js";
import { openRepositoryRuntime } from "../../repositoryRuntime/repositoryRuntime.js";
import { openSqliteChangeAuthorityPort } from "../../sqlite/sqliteChangeAuthorityPersistence.js";
import { openSqliteTaskPersistence } from "../../sqlite/sqliteTaskPersistence.js";
import { openSqliteTaskChangeLinkPort } from "../adapters/sqlite/sqliteTaskChangePersistence.js";
import { queryTaskContext, type TaskContextInspectionUseCases } from "../inspectTaskChange.js";

export type LoadTaskContextInspectionError = ResolveLocalRepositoryError;

export type LoadedTaskContextInspection<A> =
  | { readonly ok: true; readonly commonDirectory: string; readonly operation: A }
  | { readonly ok: false; readonly error: LoadTaskContextInspectionError };

type LoadInput = { readonly cwd: string };

export const loadTaskContextInspection = (
  input: LoadInput,
): LoadedTaskContextInspection<TaskContextInspectionUseCases> => {
  const loaded = openRepositoryRuntime(input.cwd);
  if (!loaded.ok) return loaded;
  return {
    ok: true,
    commonDirectory: loaded.runtime.context.commonDirectory,
    operation: {
      getTaskContextById: (taskId) =>
        loaded.runtime.provide(
          Effect.all({
            tasks: openSqliteTaskPersistence(loaded.runtime.context.taskPrefix),
            links: openSqliteTaskChangeLinkPort(),
            authority: openSqliteChangeAuthorityPort(),
          }).pipe(
            Effect.flatMap(({ tasks, links, authority }) =>
              queryTaskContext({ tasks, links, authority }, taskId),
            ),
          ),
        ),
    },
  };
};
