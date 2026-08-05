import { existsSync } from "node:fs";
import { Effect } from "effect";

import { repositoryStorageErrorResult, repoStateLoadError, type CliResult } from "../cliResults.js";
import { loadRepoLocalContext } from "../init/repoContext.js";
import { resolveRepoTaskId } from "../task/repoTaskIds.js";
import { cleanupChangeResourcesWithRemote } from "./localChangeCleanupGit.js";
import { openTerminalCleanup } from "./cleanupTerminalChange.js";
import { reviewerSessionsChangeRoot } from "./reviewerSession/reviewerSession.js";
import { openArtifactLifecycle } from "./validationRun/artifactLifecycle.js";
import { openCancellationUseCases, type CancellationUseCases } from "./cancelChange.js";
import {
  githubChangeCleanupRemote,
  localGitHubPullRequestGateway,
} from "../submissionEnvironment/localGitHubPullRequestGateway.js";
import { repositorySqlLayer } from "../sqlite/repositorySql.js";
import { openSqliteChangePersistence } from "../sqlite/sqliteChangePersistence.js";
import { openSqliteTaskPersistence } from "../sqlite/sqliteTaskPersistence.js";
import { openSqliteChangeValidationPersistence } from "../sqlite/sqliteChangeValidationPersistence.js";
import { openSqliteExecutionLock } from "../sqlite/sqliteExecutionLock.js";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";

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
    changes: openSqliteChangePersistence(),
    tasks: openSqliteTaskPersistence(context.context.taskPrefix),
    validation: openSqliteChangeValidationPersistence(),
  }).pipe(
    Effect.flatMap(({ changes, tasks, validation }) =>
      use(
        openCancellationUseCases({
          resolveTaskId: (taskId) => resolveRepoTaskId(context.context, taskId),
          changes,
          tasks,
          validation,
          executionLock: openSqliteExecutionLock({
            commonDirectory: context.context.commonDirectory,
          }),
          github,
          cleanupTerminal: openTerminalCleanup({
            persistence: changes,
            cleanup: cleanupChangeResourcesWithRemote(githubChangeCleanupRemote(github)),
            reviewerSessionPathFor: (changeId) =>
              reviewerSessionsChangeRoot(context.context.paths.operationalDir, changeId),
            artifactLifecycle: openArtifactLifecycle({
              persistence: validation,
              artifactsRoot: context.context.paths.artifactsPath,
            }),
          }),
        }),
      ),
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
