import { Effect } from "effect";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import { RepositorySql, type RepositorySqlService } from "./adapters/sqlite/repositorySql.js";
import type { LocalRepositoryContext } from "./repositoryContext.js";
import {
  openRepositoryRuntime,
  type RepositoryRuntime,
  type RepositoryRuntimeLoadError,
} from "./repositoryRuntime.js";

export type RepositoryOperationRuntime = RepositoryRuntime<LocalRepositoryContext>;
export type RepositoryOperationError = RepositoryStorageError;

export const openRepositoryOperation = (
  cwd: string,
):
  | { readonly ok: true; readonly runtime: RepositoryOperationRuntime }
  | { readonly ok: false; readonly error: RepositoryRuntimeLoadError } =>
  openRepositoryRuntime(cwd);

export const runRepositoryOperation = <A, E, R>(
  runtime: RepositoryOperationRuntime,
  use: (
    context: LocalRepositoryContext,
    repository: RepositorySqlService,
  ) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | RepositoryStorageError, R> =>
  runtime.provide(Effect.flatMap(RepositorySql, (repository) => use(runtime.context, repository)));
