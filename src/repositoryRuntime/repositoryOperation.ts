import { Effect } from "effect";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import { RepositorySql, type RepositorySqlService } from "./adapters/sqlite/repositorySql.js";
import type { LocalRepositoryContext } from "./repositoryContext.js";
import {
  openRepositoryRuntime,
  type RepositoryRuntime,
  type RepositoryRuntimeLoadError,
} from "./repositoryRuntime.js";

type RepositoryOperationRuntime = RepositoryRuntime<LocalRepositoryContext>;
export type RepositoryOperationStorageError = {
  readonly _tag: "RepositoryOperationStorageError";
  readonly error: RepositoryStorageError;
  readonly idPrefix: string;
};
export type RepositoryOperationError = RepositoryOperationStorageError | RepositoryRuntimeLoadError;

const openRepositoryOperation = (
  cwd: string,
):
  | { readonly ok: true; readonly runtime: RepositoryOperationRuntime }
  | { readonly ok: false; readonly error: RepositoryRuntimeLoadError } =>
  openRepositoryRuntime(cwd);

export const runRepositoryOperationAt = <A, E, R>(
  cwd: string,
  use: (
    context: LocalRepositoryContext,
    repository: RepositorySqlService,
  ) => Effect.Effect<A, E, R>,
): Effect.Effect<A, Exclude<E, RepositoryStorageError> | RepositoryOperationError, R> =>
  Effect.suspend(
    (): Effect.Effect<A, Exclude<E, RepositoryStorageError> | RepositoryOperationError, R> => {
      const loaded = openRepositoryOperation(cwd);
      return loaded.ok
        ? runRepositoryOperation(loaded.runtime, use).pipe(
            Effect.mapError((error) =>
              isRepositoryStorageError(error)
                ? {
                    _tag: "RepositoryOperationStorageError" as const,
                    error,
                    idPrefix: loaded.runtime.context.idPrefix,
                  }
                : (error as Exclude<E, RepositoryStorageError> | RepositoryOperationError),
            ),
          )
        : Effect.fail<RepositoryRuntimeLoadError>(loaded.error);
    },
  );

export const isRepositoryOperationStorageError = (
  error: unknown,
): error is RepositoryOperationStorageError =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  error._tag === "RepositoryOperationStorageError";

export const isRepositoryStorageError = (error: unknown): error is RepositoryStorageError =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  typeof error._tag === "string" &&
  error._tag.startsWith("Repository");

const runRepositoryOperation = <A, E, R>(
  runtime: RepositoryOperationRuntime,
  use: (
    context: LocalRepositoryContext,
    repository: RepositorySqlService,
  ) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | RepositoryStorageError, R> =>
  runtime.provide(Effect.flatMap(RepositorySql, (repository) => use(runtime.context, repository)));
