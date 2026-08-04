import { existsSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";

import { openHerdrInteractiveSessionHost } from "./herdrInteractiveSessionHost.js";
import type { InteractiveSessionHost } from "./interactiveSessionHost.js";
import { cleanupChangeResourcesWithRemote } from "./localChangeCleanupGit.js";
import { openChangeReconciliation } from "./reconcileChange.js";
import { openChangeUseCases, type ChangeUseCases } from "./changeUseCases.js";
import { provisionChangeWorktree, resolveChangeStartGitIntent } from "./changeStartGit.js";
import { executeLocalRepositoryPreparation } from "../repositoryPreparation/localRepositoryPreparation.js";
import { loadRepoLocalContext, type LoadRepoLocalContextError } from "../init/repoContext.js";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import { repositorySqlLayer } from "../sqlite/repositorySql.js";
import { openSqliteChangePersistence } from "../sqlite/sqliteChangePersistence.js";
import { openSqliteChangeStartPersistence } from "../sqlite/sqliteChangeStartPersistence.js";
import {
  githubChangeCleanupRemote,
  localGitHubPullRequestGateway,
} from "../submissionEnvironment/localGitHubPullRequestGateway.js";

export type LoadChangeUseCasesError =
  | LoadRepoLocalContextError
  | { readonly code: "state_store_unavailable"; readonly taskPrefix: string };

export type WithChangeUseCasesResult<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: LoadChangeUseCasesError };

export const withChangeUseCases = <A, E, R>(
  input: {
    readonly cwd: string;
    readonly globalConfigPath: string;
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

  const github = localGitHubPullRequestGateway();
  return Effect.all({
    startPersistence: openSqliteChangeStartPersistence(),
    changePersistence: openSqliteChangePersistence(),
  }).pipe(
    Effect.flatMap(({ startPersistence, changePersistence }) =>
      use(
        openChangeUseCases(
          repoContext.context,
          startPersistence,
          {
            resolveIntent: (slug, requestedBaseBranch) =>
              resolveChangeStartGitIntent(repoContext.context, slug, requestedBaseBranch),
            provisionWorktree: (change, recovering) =>
              provisionChangeWorktree(repoContext.context.root, change, recovering),
          },
          executeLocalRepositoryPreparation,
          openChangeReconciliation({
            persistence: changePersistence,
            github,
            cleanup: cleanupChangeResourcesWithRemote(githubChangeCleanupRemote(github)),
            reviewerSessionPathFor: (changeId) =>
              join(repoContext.context.paths.operationalDir, changeId),
          }),
          input.interactiveSessionHost ??
            openHerdrInteractiveSessionHost(undefined, {
              ...(input.interactiveSessionPath === undefined
                ? {}
                : { path: input.interactiveSessionPath }),
            }),
          input.globalConfigPath,
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
