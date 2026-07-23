import { existsSync } from "node:fs";
import { Effect } from "effect";

import { repositoryStorageErrorResult, repoStateLoadError, type CliResult } from "../cliResults.js";
import { loadRepoLocalContext } from "../init/repoContext.js";
import { resolveRepoTaskId } from "../task/repoTaskIds.js";
import { cleanupChangeResources } from "./localChangeCleanupGit.js";
import { openCancellationUseCases, type CancellationUseCases } from "./cancelChange.js";
import { localGitHubPullRequestGateway } from "../submissionEnvironment/localGitHubPullRequestGateway.js";
import { repositorySqlLayer } from "../sqlite/repositorySql.js";
import { openSqliteChangePersistence } from "../sqlite/sqliteChangePersistence.js";
import { openSqliteTaskPersistence } from "../sqlite/sqliteTaskPersistence.js";
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

  const program = Effect.all({
    changes: openSqliteChangePersistence(),
    tasks: openSqliteTaskPersistence(context.context.taskPrefix),
  }).pipe(
    Effect.flatMap(({ changes, tasks }) =>
      use(
        openCancellationUseCases({
          resolveTaskId: (taskId) => resolveRepoTaskId(context.context, taskId),
          changes,
          tasks,
          github: localGitHubPullRequestGateway({ cwd: context.context.root }),
          cleanup: cleanupChangeResources,
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
