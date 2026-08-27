import { Effect } from "effect";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import {
  type RepositoryOperationError,
  runRepositoryOperationAt,
} from "../../repositoryRuntime/repositoryOperation.js";
import { resolveRepoTaskId, type RepoTaskIdResolution } from "../../task/repoTaskIds.js";
import type {
  EditTaskDependenciesInput,
  EditTaskDependenciesResult,
  RenameTaskInput,
  RenameTaskResult,
  ReviseTaskInput,
  ReviseTaskResult,
} from "../../task/taskStore.js";
import type { PublicTaskId } from "../../task/taskId.js";
import {
  editTaskDependenciesWithChangePrecondition,
  renameTaskWithChangePrecondition,
  reviseTaskWithChangePrecondition,
} from "./taskChangeMutations.js";

type TaskIdResolutionFailure = {
  readonly ok: false;
  readonly error: Exclude<RepoTaskIdResolution, { readonly ok: true }>;
};

type CommandResult<A> = A | TaskIdResolutionFailure;
type RepositoryContext = Parameters<typeof resolveRepoTaskId>[0];

const resolveTask = (context: RepositoryContext, taskId: PublicTaskId) => {
  const resolved = resolveRepoTaskId(context, taskId);
  return resolved.ok ? resolved.taskId : resolved;
};

const resolveTasks = (
  context: RepositoryContext,
  taskIds: readonly PublicTaskId[],
): PublicTaskId[] | TaskIdResolutionFailure => {
  const resolved: PublicTaskId[] = [];
  for (const taskId of taskIds) {
    const value = resolveTask(context, taskId);
    if (typeof value !== "string") return { ok: false, error: value };
    resolved.push(value);
  }
  return resolved;
};

type EditTaskDependenciesCommandResult = CommandResult<EditTaskDependenciesResult>;
export const editTaskDependenciesCommand = (
  cwd: string,
  input: EditTaskDependenciesInput,
): Effect.Effect<EditTaskDependenciesCommandResult, RepositoryOperationError> =>
  runRepositoryOperationAt<EditTaskDependenciesCommandResult, RepositoryStorageError, never>(
    cwd,
    (context, repository) => {
      const taskId = resolveTask(context, input.taskId);
      if (typeof taskId !== "string") return Effect.succeed({ ok: false, error: taskId });
      const prerequisiteTaskIds = resolveTasks(context, input.prerequisiteTaskIds);
      if (!Array.isArray(prerequisiteTaskIds)) return Effect.succeed(prerequisiteTaskIds);
      return repository.transactionImmediate("edit Task dependencies", (sql) =>
        editTaskDependenciesWithChangePrecondition(
          sql,
          { ...input, taskId, prerequisiteTaskIds },
          repository.idPrefix,
        ),
      );
    },
  );

type RenameTaskCommandResult = CommandResult<RenameTaskResult>;
export const renameTaskCommand = (
  cwd: string,
  input: RenameTaskInput,
): Effect.Effect<RenameTaskCommandResult, RepositoryOperationError> =>
  runRepositoryOperationAt<RenameTaskCommandResult, RepositoryStorageError, never>(
    cwd,
    (context, repository) => {
      const taskId = resolveTask(context, input.taskId);
      if (typeof taskId !== "string") return Effect.succeed({ ok: false, error: taskId });
      return repository.transactionImmediate("rename Task", (sql) =>
        renameTaskWithChangePrecondition(sql, { ...input, taskId }, repository.idPrefix),
      );
    },
  );

type ReviseTaskCommandResult = CommandResult<ReviseTaskResult>;
export const reviseTaskCommand = (
  cwd: string,
  input: ReviseTaskInput,
): Effect.Effect<ReviseTaskCommandResult, RepositoryOperationError> =>
  runRepositoryOperationAt<ReviseTaskCommandResult, RepositoryStorageError, never>(
    cwd,
    (context, repository) => {
      const taskId = resolveTask(context, input.taskId);
      if (typeof taskId !== "string") return Effect.succeed({ ok: false, error: taskId });
      return repository.transactionImmediate("revise Task", (sql) =>
        reviseTaskWithChangePrecondition(sql, { ...input, taskId }, repository.idPrefix),
      );
    },
  );
