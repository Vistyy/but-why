import { existsSync } from "node:fs";
import { Effect } from "effect";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import { type LoadRepoLocalContextError, loadRepoLocalContext } from "../init/repoContext.js";
import { executeLocalRepositoryPreparation } from "../repositoryPreparation/localRepositoryPreparation.js";
import { repositorySqlLayer } from "../sqlite/repositorySql.js";
import {
  openSqliteChangeReconciliationPort,
  openSqliteChangeReviewerTranscriptPort,
  openSqliteTerminalChangeCleanupPort,
} from "../sqlite/sqliteChangePersistence.js";
import { openSqliteChangeStartPersistence } from "../sqlite/sqliteChangeStartPersistence.js";
import { openSqliteValidationArtifactLifecyclePort } from "../sqlite/sqliteChangeValidationPersistence.js";
import {
  githubChangeCleanupRemote,
  localGitHubPullRequestGateway,
} from "../submissionEnvironment/localGitHubPullRequestGateway.js";
import {
  type ChangeImplementResult,
  type ChangePrepareResult,
  type ChangeStartResult,
  implementChange,
  prepareChange,
  startChange,
} from "./changeLifecycle.js";
import { provisionChangeWorktree, resolveChangeStartGitIntent } from "./changeStartGit.js";
import { openTerminalCleanup } from "./cleanupTerminalChange.js";
import { openHerdrInteractiveSessionHost } from "./interactiveSession/herdrInteractiveSessionHost.js";
import type { InteractiveSessionHost } from "./interactiveSession/interactiveSessionHost.js";
import { cleanupChangeResourcesWithRemote } from "./localChangeCleanupGit.js";
import { type ChangeReconciliationResult, openChangeReconciliation } from "./reconcileChange.js";
import { reviewerSessionsChangeRoot } from "./reviewerSession/reviewerSession.js";
import { openReviewerTranscriptIndex } from "./reviewerSession/reviewerTranscript.js";
import { openArtifactLifecycle } from "./validationRun/artifactLifecycle.js";

export type LoadChangeOperationError =
  | LoadRepoLocalContextError
  | { readonly code: "state_store_unavailable"; readonly taskPrefix: string };

export type LoadedChangeOperationResult<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: LoadChangeOperationError };

type LoadInput = {
  readonly cwd: string;
  readonly globalConfigPath: string;
  readonly interactiveSessionHost?: InteractiveSessionHost;
};

const loadContext = (input: LoadInput) => {
  const loaded = loadRepoLocalContext(input.cwd);
  if (!loaded.ok) return loaded;
  if (!existsSync(loaded.context.paths.statePath)) {
    return {
      ok: false as const,
      error: {
        code: "state_store_unavailable" as const,
        taskPrefix: loaded.context.taskPrefix,
      },
    };
  }
  return loaded;
};

const provideRepository = <A, E, R>(
  statePath: string,
  commonDirectory: string,
  effect: Effect.Effect<A, E, R | import("../sqlite/repositorySql.js").RepositorySql>,
) => effect.pipe(Effect.provide(repositorySqlLayer({ statePath, commonDirectory })));

export const withChangeStart = <A, E, R>(
  input: LoadInput,
  use: (
    start: (
      command: Parameters<typeof startChange>[3],
    ) => Effect.Effect<ChangeStartResult, RepositoryStorageError>,
  ) => Effect.Effect<A, E, R>,
): Effect.Effect<LoadedChangeOperationResult<A>, E | RepositoryStorageError, R> => {
  const loaded = loadContext(input);
  if (!loaded.ok) return Effect.succeed(loaded);
  const context = loaded.context;
  return provideRepository(
    context.paths.statePath,
    context.commonDirectory,
    openSqliteChangeStartPersistence().pipe(
      Effect.flatMap((store) =>
        use((command) =>
          startChange(
            store,
            {
              resolveIntent: (slug, requestedBaseBranch) =>
                resolveChangeStartGitIntent(context, slug, requestedBaseBranch),
              provisionWorktree: (change, recovering) =>
                provisionChangeWorktree(context.root, change, recovering),
            },
            executeLocalRepositoryPreparation,
            command,
          ),
        ),
      ),
      Effect.map((value) => ({ ok: true as const, value })),
    ),
  );
};

export const withChangePrepare = <A, E, R>(
  input: LoadInput,
  use: (
    prepare: (
      changeId: string,
      now: string,
    ) => Effect.Effect<ChangePrepareResult, RepositoryStorageError>,
  ) => Effect.Effect<A, E, R>,
): Effect.Effect<LoadedChangeOperationResult<A>, E | RepositoryStorageError, R> => {
  const loaded = loadContext(input);
  if (!loaded.ok) return Effect.succeed(loaded);
  const context = loaded.context;
  return provideRepository(
    context.paths.statePath,
    context.commonDirectory,
    openSqliteChangeStartPersistence().pipe(
      Effect.flatMap((store) =>
        use((changeId, now) =>
          prepareChange(
            store,
            {
              resolveIntent: (slug, requestedBaseBranch) =>
                resolveChangeStartGitIntent(context, slug, requestedBaseBranch),
              provisionWorktree: (change, recovering) =>
                provisionChangeWorktree(context.root, change, recovering),
            },
            executeLocalRepositoryPreparation,
            changeId,
            now,
          ),
        ),
      ),
      Effect.map((value) => ({ ok: true as const, value })),
    ),
  );
};

export const withChangeImplement = <A, E, R>(
  input: LoadInput,
  use: (
    implement: (
      changeId: string,
      implementerPrompt: string | undefined,
    ) => Effect.Effect<ChangeImplementResult, RepositoryStorageError>,
  ) => Effect.Effect<A, E, R>,
): Effect.Effect<LoadedChangeOperationResult<A>, E | RepositoryStorageError, R> => {
  const loaded = loadContext(input);
  if (!loaded.ok) return Effect.succeed(loaded);
  const context = loaded.context;
  return provideRepository(
    context.paths.statePath,
    context.commonDirectory,
    openSqliteChangeStartPersistence().pipe(
      Effect.flatMap((store) =>
        use((changeId, implementerPrompt) =>
          implementChange(
            context,
            store,
            input.interactiveSessionHost ?? openHerdrInteractiveSessionHost(),
            input.globalConfigPath,
            changeId,
            implementerPrompt,
          ),
        ),
      ),
      Effect.map((value) => ({ ok: true as const, value })),
    ),
  );
};

export const withChangeReconciliation = <A, E, R>(
  input: LoadInput,
  use: (
    reconcile: (
      changeId: string | undefined,
      now: string,
      discardWork?: boolean,
    ) => Effect.Effect<ChangeReconciliationResult, RepositoryStorageError>,
  ) => Effect.Effect<A, E, R>,
): Effect.Effect<LoadedChangeOperationResult<A>, E | RepositoryStorageError, R> => {
  const loaded = loadContext(input);
  if (!loaded.ok) return Effect.succeed(loaded);
  const context = loaded.context;
  const github = localGitHubPullRequestGateway();
  return provideRepository(
    context.paths.statePath,
    context.commonDirectory,
    Effect.all({
      reconciliationStore: openSqliteChangeReconciliationPort(),
      terminalCleanup: openSqliteTerminalChangeCleanupPort(),
      reviewerTranscripts: openSqliteChangeReviewerTranscriptPort(),
      artifactLifecyclePersistence: openSqliteValidationArtifactLifecyclePort(),
    }).pipe(
      Effect.flatMap(
        ({
          reconciliationStore,
          terminalCleanup,
          reviewerTranscripts,
          artifactLifecyclePersistence,
        }) => {
          const reconciliation = openChangeReconciliation({
            persistence: reconciliationStore,
            github,
            cleanupTerminal: openTerminalCleanup({
              persistence: terminalCleanup,
              cleanup: cleanupChangeResourcesWithRemote(githubChangeCleanupRemote(github)),
              indexTranscripts: openReviewerTranscriptIndex({ persistence: reviewerTranscripts }),
              reviewerSessionPathFor: (changeId) =>
                reviewerSessionsChangeRoot(context.paths.operationalDir, changeId),
              artifactLifecycle: openArtifactLifecycle({
                persistence: artifactLifecyclePersistence,
                artifactsRoot: context.paths.artifactsPath,
              }),
            }),
          });
          return use((changeId, now, discardWork) =>
            reconciliation.reconcile({
              repositoryCommonDirectory: context.commonDirectory,
              ...(changeId === undefined ? {} : { changeId }),
              now,
              ...(discardWork === undefined ? {} : { discardWork }),
            }),
          );
        },
      ),
      Effect.map((value) => ({ ok: true as const, value })),
    ),
  );
};
