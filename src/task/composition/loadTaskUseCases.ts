import { Effect } from "effect";

import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import { openSqliteTaskPersistence } from "../../repositoryRuntime/adapters/sqlite/sqliteTaskPersistence.js";
import type { ResolveLocalRepositoryError } from "../../repositoryRuntime/repositoryContext.js";
import { openRepositoryRuntime } from "../../repositoryRuntime/repositoryRuntime.js";
import { openTaskUseCases, type TaskUseCases } from "../taskUseCases.js";

export type LoadTaskUseCasesInput = {
  readonly cwd: string;
};

export type LoadTaskUseCasesError =
  | ResolveLocalRepositoryError
  | {
      readonly code: "state_store_unavailable";
      readonly idPrefix: string;
    };

export type WithTaskUseCasesResult<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: LoadTaskUseCasesError };

export const withTaskUseCases = <A, E, R>(
  input: LoadTaskUseCasesInput,
  use: (tasks: TaskUseCases) => Effect.Effect<A, E, R>,
): Effect.Effect<WithTaskUseCasesResult<A>, E | RepositoryStorageError, R> => {
  const loaded = openRepositoryRuntime(input.cwd);
  if (!loaded.ok) return Effect.succeed(loaded);
  const { context } = loaded.runtime;

  return loaded.runtime.provide(
    openSqliteTaskPersistence().pipe(
      Effect.flatMap((persistence) => use(openTaskUseCases(context, persistence))),
      Effect.map((value) => ({ ok: true as const, value })),
    ),
  );
};
