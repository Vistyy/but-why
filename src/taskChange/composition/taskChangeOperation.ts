import { Effect } from "effect";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import {
  RepositorySql,
  type RepositorySqlService,
} from "../../repositoryRuntime/adapters/sqlite/repositorySql.js";
import type { LocalRepositoryContext } from "../../repositoryRuntime/repositoryContext.js";
import {
  openRepositoryRuntime,
  type RepositoryRuntimeLoadError,
} from "../../repositoryRuntime/repositoryRuntime.js";

export type TaskChangeOperationError = RepositoryRuntimeLoadError | RepositoryStorageError;

export const runTaskChangeOperation = <A, E, R>(
  cwd: string,
  use: (
    context: LocalRepositoryContext,
    repository: RepositorySqlService,
  ) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | TaskChangeOperationError, R> => {
  const loaded = openRepositoryRuntime(cwd);
  if (!loaded.ok) return Effect.fail(loaded.error);
  return loaded.runtime.provide(
    Effect.flatMap(RepositorySql, (repository) => use(loaded.runtime.context, repository)),
  );
};
