import { existsSync } from "node:fs";
import { Effect } from "effect";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import { type LoadRepoLocalContextError, loadRepoLocalContext } from "../init/repoContext.js";
import { executeLocalRepositoryPreparation } from "../repositoryPreparation/localRepositoryPreparation.js";
import { repositorySqlLayer } from "../sqlite/repositorySql.js";
import { openSqliteChangePersistence } from "../sqlite/sqliteChangePersistence.js";
import { openSqliteChangeStartPersistence } from "../sqlite/sqliteChangeStartPersistence.js";
import { openSqliteChangeValidationPersistence } from "../sqlite/sqliteChangeValidationPersistence.js";
import {
  githubChangeCleanupRemote,
  localGitHubPullRequestGateway,
} from "../submissionEnvironment/localGitHubPullRequestGateway.js";
import { provisionChangeWorktree, resolveChangeStartGitIntent } from "./changeStartGit.js";
import { type ChangeUseCases, openChangeUseCases } from "./changeUseCases.js";
import { openTerminalCleanup } from "./cleanupTerminalChange.js";
import { openHerdrInteractiveSessionHost } from "./interactiveSession/herdrInteractiveSessionHost.js";
import type { InteractiveSessionHost } from "./interactiveSession/interactiveSessionHost.js";
import { cleanupChangeResourcesWithRemote } from "./localChangeCleanupGit.js";
import { openChangeReconciliation } from "./reconcileChange.js";
import { reviewerSessionsChangeRoot } from "./reviewerSession/reviewerSession.js";
import { openReviewerTranscriptIndex } from "./reviewerSession/reviewerTranscript.js";
import { openArtifactLifecycle } from "./validationRun/artifactLifecycle.js";

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
    validationPersistence: openSqliteChangeValidationPersistence(),
  }).pipe(
    Effect.flatMap(({ startPersistence, changePersistence, validationPersistence }) =>
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
            cleanupTerminal: openTerminalCleanup({
              persistence: changePersistence,
              cleanup: cleanupChangeResourcesWithRemote(githubChangeCleanupRemote(github)),
              indexTranscripts: openReviewerTranscriptIndex({
                persistence: changePersistence,
              }),
              reviewerSessionPathFor: (changeId) =>
                reviewerSessionsChangeRoot(repoContext.context.paths.operationalDir, changeId),
              artifactLifecycle: openArtifactLifecycle({
                persistence: validationPersistence,
                artifactsRoot: repoContext.context.paths.artifactsPath,
              }),
            }),
          }),
          input.interactiveSessionHost ?? openHerdrInteractiveSessionHost(),
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
