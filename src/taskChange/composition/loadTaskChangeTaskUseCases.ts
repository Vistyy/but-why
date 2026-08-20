import { Effect } from "effect";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import {
  openRepositoryRuntime,
  type RepositoryRuntimeLoadError,
} from "../../repositoryRuntime/repositoryRuntime.js";
import { type RepoTaskIdResolution, resolveRepoTaskId } from "../../task/repoTaskIds.js";
import type { PublicTaskId } from "../../task/taskId.js";
import type {
  EditTaskDependenciesInput,
  EditTaskDependenciesResult,
  RenameTaskInput,
  RenameTaskResult,
  ReviseTaskInput,
  ReviseTaskResult,
} from "../../task/taskStore.js";
import { openSqliteTaskChangeTaskPersistence } from "../adapters/sqlite/sqliteTaskChangePersistence.js";
import { taskChangeTaskMutationOperations } from "./loadTaskChangePersistence.js";

export type TaskChangeTaskUseCases = {
  readonly idPrefix: string;
  readonly resolveTaskId: (taskId: PublicTaskId) => RepoTaskIdResolution;
  readonly editTaskDependencies: (
    input: EditTaskDependenciesInput,
  ) => Effect.Effect<EditTaskDependenciesResult, RepositoryStorageError>;
  readonly renameTask: (
    input: RenameTaskInput,
  ) => Effect.Effect<RenameTaskResult, RepositoryStorageError>;
  readonly reviseTask: (
    input: ReviseTaskInput,
  ) => Effect.Effect<ReviseTaskResult, RepositoryStorageError>;
};

export type LoadTaskChangeTaskUseCasesResult<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: RepositoryRuntimeLoadError };

export const withTaskChangeTaskUseCases = <A, E, R>(
  input: { readonly cwd: string },
  use: (tasks: TaskChangeTaskUseCases) => Effect.Effect<A, E, R>,
): Effect.Effect<LoadTaskChangeTaskUseCasesResult<A>, E | RepositoryStorageError, R> => {
  const loaded = openRepositoryRuntime(input.cwd);
  if (!loaded.ok) return Effect.succeed(loaded);
  const { context } = loaded.runtime;
  return loaded.runtime.provide(
    openSqliteTaskChangeTaskPersistence(taskChangeTaskMutationOperations).pipe(
      Effect.flatMap((persistence) =>
        use({
          idPrefix: context.idPrefix,
          resolveTaskId: (taskId) => resolveRepoTaskId(context, taskId),
          editTaskDependencies: persistence.editTaskDependencies,
          renameTask: persistence.renameTask,
          reviseTask: persistence.reviseTask,
        }),
      ),
      Effect.map((value) => ({ ok: true as const, value })),
    ),
  );
};
