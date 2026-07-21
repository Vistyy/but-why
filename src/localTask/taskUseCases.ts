import { existsSync } from "node:fs";
import { Effect } from "effect";

import type { RepositoryStorageError } from "../repositoryStorageError.js";
import { repositorySqlLayer } from "../sqlite/repositorySql.js";
import { openSqliteTaskPersistence } from "../sqlite/sqliteTaskPersistence.js";
import { openTaskUseCases, type TaskUseCases } from "../task/taskUseCases.js";
import { loadRepoLocalContext, type LoadRepoLocalContextError } from "../init/repoContext.js";

export type LoadTaskUseCasesInput = {
  readonly cwd: string;
  readonly requireState: boolean;
};

export type LoadTaskUseCasesError =
  | LoadRepoLocalContextError
  | {
      readonly code: "state_store_unavailable";
      readonly taskPrefix: string;
    };

export type WithTaskUseCasesResult<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: LoadTaskUseCasesError };

export const withTaskUseCases = <A, E, R>(
  input: LoadTaskUseCasesInput,
  use: (tasks: TaskUseCases) => Effect.Effect<A, E, R>,
): Effect.Effect<WithTaskUseCasesResult<A>, E | RepositoryStorageError, R> => {
  const repoContext = loadRepoLocalContext(input.cwd);
  if (!repoContext.ok) return Effect.succeed(repoContext);

  if (input.requireState && !existsSync(repoContext.context.paths.statePath)) {
    return Effect.succeed({
      ok: false,
      error: {
        code: "state_store_unavailable",
        taskPrefix: repoContext.context.taskPrefix,
      },
    });
  }

  return openSqliteTaskPersistence(repoContext.context.taskPrefix).pipe(
    Effect.flatMap((persistence) => use(openTaskUseCases(repoContext.context, persistence))),
    Effect.map((value) => ({ ok: true as const, value })),
    Effect.provide(
      repositorySqlLayer({
        statePath: repoContext.context.paths.statePath,
        commonDirectory: repoContext.context.commonDirectory,
      }),
    ),
  );
};
