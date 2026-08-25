import { Effect } from "effect";
import { openSqliteActiveValidationRunPort } from "../../change/adapters/sqlite/sqliteActiveValidationRunPersistence.js";
import { taskChangeCancellationChangeOperations } from "../../change/composition/loadChangePersistence.js";
import { composeTerminalCleanup } from "../../change/composition/terminalCleanup.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import { openSqliteExecutionLock } from "../../repositoryRuntime/adapters/sqlite/sqliteExecutionLock.js";
import {
  openRepositoryRuntime,
  type RepositoryRuntimeLoadError,
} from "../../repositoryRuntime/repositoryRuntime.js";
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
        taskChangeCancellationChangeOperations,
        taskChangeCancellationOperations,
        taskChangeCompletionOperations,
      ),
      tasks: openSqliteTaskPersistence(),
      activeValidation: openSqliteActiveValidationRunPort(),
      cleanupTerminal: composeTerminalCleanup(context),
    }).pipe(
      Effect.flatMap(({ changes, tasks, activeValidation, cleanupTerminal }) =>
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
            cleanupTerminal,
          }),
        ),
      ),
      Effect.map((value) => ({ ok: true as const, value })),
    ),
  );
};
