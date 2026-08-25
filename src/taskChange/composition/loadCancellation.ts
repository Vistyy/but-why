import { Effect } from "effect";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import { openSqliteExecutionLock } from "../../repositoryRuntime/adapters/sqlite/sqliteExecutionLock.js";
import {
  openRepositoryRuntime,
  type RepositoryRuntimeLoadError,
} from "../../repositoryRuntime/repositoryRuntime.js";
import { openSqliteActiveValidationRunPort } from "../../sqlite/sqliteActiveValidationRunPersistence.js";
import { localGitHubPullRequestGateway } from "../../submissionEnvironment/adapters/localGitHubPullRequestGateway.js";
import { openSqliteTaskPersistence } from "../../task/adapters/sqlite/sqliteTaskPersistence.js";
import { resolveRepoTaskId } from "../../task/repoTaskIds.js";
import { openSqliteTaskChangeCancellationPort } from "../adapters/sqlite/sqliteTaskChangeCancellationPersistence.js";
import { type CancellationUseCases, openCancellationUseCases } from "../cancelTaskChange.js";
import {
  taskChangeCancellationOperations,
  taskChangeCompletionOperations,
} from "./loadTaskChangePersistence.js";

type WithCancellationUseCasesResult<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: RepositoryRuntimeLoadError };

export const withCancellationUseCases = <A, E, R>(
  input: { readonly cwd: string },
  use: (cancellation: CancellationUseCases) => Effect.Effect<A, E, R>,
): Effect.Effect<WithCancellationUseCasesResult<A>, E | RepositoryStorageError, R> => {
  const loaded = openRepositoryRuntime(input.cwd);
  if (!loaded.ok) return Effect.succeed(loaded);
  const { context } = loaded.runtime;

  return loaded.runtime.provide(
    Effect.all({
      changes: openSqliteTaskChangeCancellationPort(
        taskChangeCancellationOperations,
        taskChangeCompletionOperations,
      ),
      tasks: openSqliteTaskPersistence(),
      activeValidation: openSqliteActiveValidationRunPort(),
    }).pipe(
      Effect.flatMap(({ changes, tasks, activeValidation }) =>
        use(
          openCancellationUseCases({
            resolveTaskId: (taskId) => resolveRepoTaskId(context, taskId),
            changes,
            tasks,
            validation: activeValidation,
            executionLock: openSqliteExecutionLock({
              commonDirectory: context.commonDirectory,
            }),
            github: localGitHubPullRequestGateway({ cwd: context.root }),
          }),
        ),
      ),
      Effect.map((value) => ({ ok: true as const, value })),
    ),
  );
};
