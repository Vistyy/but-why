import { existsSync } from "node:fs";
import { Effect } from "effect";

import { type CliResult, repoStateLoadError, repositoryStorageErrorResult } from "../cliResults.js";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import { loadRepoLocalContext } from "../init/repoContext.js";
import { repositorySqlLayer } from "../sqlite/repositorySql.js";
import {
  openSqliteChangeDeliveryPort,
  openSqliteChangeReadPort,
  openSqliteChangeReviewerSessionPort,
  openSqliteChangeReviewerTranscriptPort,
} from "../sqlite/sqliteChangePersistence.js";
import {
  openSqliteActiveValidationRunPort,
  openSqliteValidationArtifactLifecyclePort,
} from "../sqlite/sqliteChangeValidationPersistence.js";
import { openSqliteExecutionLock } from "../sqlite/sqliteExecutionLock.js";
import { openSqliteTaskPersistence } from "../sqlite/sqliteTaskPersistence.js";
import {
  githubChangeCleanupRemote,
  localGitHubPullRequestGateway,
} from "../submissionEnvironment/localGitHubPullRequestGateway.js";
import { resolveRepoTaskId } from "../task/repoTaskIds.js";
import { type CancellationUseCases, openCancellationUseCases } from "./cancelChange.js";
import { openTerminalCleanup } from "./cleanupTerminalChange.js";
import { cleanupChangeResourcesWithRemote } from "./localChangeCleanupGit.js";
import { reviewerSessionsChangeRoot } from "./reviewerSession/reviewerSession.js";
import { openReviewerTranscriptIndex } from "./reviewerSession/reviewerTranscript.js";
import { openArtifactLifecycle } from "./validationRun/artifactLifecycle.js";

export type CancellationCommandEnvironment = {
  readonly cwd: string;
  readonly cancellationUseCases?: CancellationUseCases;
};

export const withCancellation = <A, R>(
  environment: CancellationCommandEnvironment,
  use: (cancellation: CancellationUseCases) => Effect.Effect<A, RepositoryStorageError, R>,
): Effect.Effect<A | CliResult, never, R> => {
  if (environment.cancellationUseCases !== undefined) {
    return use(environment.cancellationUseCases).pipe(
      Effect.catchAll((error) => Effect.succeed(repositoryStorageErrorResult(error))),
    );
  }

  const context = loadRepoLocalContext(environment.cwd);
  if (!context.ok) return Effect.succeed(repoStateLoadError(context.error));
  if (!existsSync(context.context.paths.statePath)) {
    return Effect.succeed({
      ...repoStateLoadError({
        code: "state_store_unavailable",
        taskPrefix: context.context.taskPrefix,
      }),
    });
  }

  const github = localGitHubPullRequestGateway({ cwd: context.context.root });
  const program = Effect.all({
    delivery: openSqliteChangeDeliveryPort(),
    changeReads: openSqliteChangeReadPort(),
    reviewerSessions: openSqliteChangeReviewerSessionPort(),
    reviewerTranscripts: openSqliteChangeReviewerTranscriptPort(),
    tasks: openSqliteTaskPersistence(context.context.taskPrefix),
    activeValidation: openSqliteActiveValidationRunPort(),
    artifactLifecycle: openSqliteValidationArtifactLifecyclePort(),
  }).pipe(
    Effect.flatMap(
      ({
        delivery,
        changeReads,
        reviewerSessions,
        reviewerTranscripts,
        tasks,
        activeValidation,
        artifactLifecycle,
      }) => {
        const changes = { ...delivery, ...changeReads };
        return use(
          openCancellationUseCases({
            resolveTaskId: (taskId) => resolveRepoTaskId(context.context, taskId),
            changes,
            tasks,
            validation: activeValidation,
            executionLock: openSqliteExecutionLock({
              commonDirectory: context.context.commonDirectory,
            }),
            github,
            cleanupTerminal: openTerminalCleanup({
              persistence: { ...delivery, ...reviewerSessions },
              cleanup: cleanupChangeResourcesWithRemote(githubChangeCleanupRemote(github)),
              indexTranscripts: openReviewerTranscriptIndex({
                persistence: reviewerTranscripts,
              }),
              reviewerSessionPathFor: (changeId) =>
                reviewerSessionsChangeRoot(context.context.paths.operationalDir, changeId),
              artifactLifecycle: openArtifactLifecycle({
                persistence: artifactLifecycle,
                artifactsRoot: context.context.paths.artifactsPath,
              }),
            }),
          }),
        );
      },
    ),
  );
  return program.pipe(
    Effect.provide(
      repositorySqlLayer({
        statePath: context.context.paths.statePath,
        commonDirectory: context.context.commonDirectory,
      }),
    ),
    Effect.catchAll((error) => Effect.succeed(repositoryStorageErrorResult(error))),
  );
};
