import { existsSync } from "node:fs";
import { Effect } from "effect";

import { openHerdrInteractiveSessionHost } from "../change/herdrInteractiveSessionHost.js";
import type { InteractiveSessionHost } from "../change/interactiveSessionHost.js";
import { cleanupChangeResources } from "../change/localChangeCleanupGit.js";
import { openChangeReconciliation } from "../change/reconcileChange.js";
import { openChangeUseCases, type ChangeUseCases } from "../change/changeUseCases.js";
import { provisionChangeWorktree, resolveChangeStartGitIntent } from "../change/changeStartGit.js";
import { openRepoLocalStores } from "../init/repoLocalStores.js";
import { executeLocalRepositoryPreparation } from "../repositoryPreparation/localRepositoryPreparation.js";
import { loadRepoLocalContext, type LoadRepoLocalContextError } from "../init/repoContext.js";
import type { RepositoryStorageError } from "../repositoryStorageError.js";
import { repositorySqlLayer } from "../sqlite/repositorySql.js";
import { openSqliteChangeStartPersistence } from "../sqlite/sqliteChangeStartPersistence.js";
import { localGitHubPullRequestGateway } from "../submissionEnvironment/localGitHubPullRequestGateway.js";

export type LoadChangeUseCasesError =
  | LoadRepoLocalContextError
  | { readonly code: "state_store_unavailable"; readonly taskPrefix: string };

export type WithChangeUseCasesResult<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: LoadChangeUseCasesError };

export const withChangeUseCases = <A, E, R>(
  input: {
    readonly cwd: string;
    readonly interactiveSessionHost?: InteractiveSessionHost;
    readonly interactiveSessionPath?: string;
  },
  use: (changes: ChangeUseCases) => Effect.Effect<A, E, R>,
): Effect.Effect<WithChangeUseCasesResult<A>, E | RepositoryStorageError, R> => {
  const repoContext = loadRepoLocalContext(input.cwd);
  if (!repoContext.ok) return Effect.succeed(repoContext);
  if (!existsSync(repoContext.context.paths.statePath)) {
    return Effect.succeed({
      ok: false,
      error: {
        code: "state_store_unavailable",
        taskPrefix: repoContext.context.taskPrefix,
      },
    });
  }

  const stores = openRepoLocalStores(repoContext.context);
  return openSqliteChangeStartPersistence().pipe(
    Effect.flatMap((persistence) =>
      use(
        openChangeUseCases(
          repoContext.context,
          persistence,
          {
            resolveIntent: (slug) => resolveChangeStartGitIntent(repoContext.context, slug),
            provisionWorktree: (change, recovering) =>
              provisionChangeWorktree(repoContext.context.root, change, recovering),
          },
          executeLocalRepositoryPreparation,
          openChangeReconciliation({
            changeStore: stores.changeStore,
            github: localGitHubPullRequestGateway(),
            cleanup: cleanupChangeResources,
          }),
          input.interactiveSessionHost ??
            openHerdrInteractiveSessionHost(undefined, {
              ...(input.interactiveSessionPath === undefined
                ? {}
                : { path: input.interactiveSessionPath }),
            }),
        ),
      ),
    ),
    Effect.map((value) => ({ ok: true as const, value })),
    Effect.provide(
      repositorySqlLayer({
        statePath: repoContext.context.paths.statePath,
        commonDirectory: repoContext.context.commonDirectory,
      }),
    ),
  );
};
