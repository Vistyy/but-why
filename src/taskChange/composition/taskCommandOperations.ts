import { Effect } from "effect";
import {
  RepositoryStateUnavailable,
  type RepositoryStorageError,
} from "../../contracts/repositoryStorageError.js";
import {
  type RepositoryOperationError,
  runRepositoryOperationAt,
} from "../../repositoryRuntime/repositoryOperation.js";
import {
  createTaskSqlite,
  getTaskContextById,
  updateTaskContext,
} from "../../task/adapters/sqlite/sqliteTaskPersistence.js";
import {
  readTaskContextDraft,
  removeTaskContextDraft,
  type TaskContextDraftReadError,
  writeTaskContextDraft,
} from "../../task/files/contextDraft.js";
import type { TaskState } from "../../task/lifecycle.js";
import { type RepoTaskIdResolution, resolveRepoTaskId } from "../../task/repoTaskIds.js";
import type { DependencyValidationCode, TaskContext, TaskRecord } from "../../task/task.js";
import type { PublicTaskId } from "../../task/taskId.js";
import type {
  CreateTaskInput,
  EditTaskDependenciesInput,
  EditTaskDependenciesResult,
  RenameTaskInput,
  RenameTaskResult,
  ReviseTaskInput,
  ReviseTaskResult,
} from "../../task/taskStore.js";
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

type ApplyTaskContextDraftInput = {
  readonly taskId: PublicTaskId;
  readonly now: string;
};

type ApplyTaskContextDraftResult =
  | { readonly ok: true; readonly task: TaskRecord; readonly context: TaskContext }
  | { readonly ok: false; readonly code: "task_not_found" }
  | {
      readonly ok: false;
      readonly code: "task_revision_required" | "invalid_task_state";
      readonly state: TaskState;
    }
  | { readonly ok: false; readonly error: TaskContextDraftReadError }
  | {
      readonly ok: false;
      readonly code: "task_context_draft_cleanup_failed";
      readonly task: TaskRecord;
      readonly path: string;
    };

type CreateTaskResult =
  | { readonly ok: true; readonly task: TaskRecord; readonly context: TaskContext }
  | { readonly ok: false; readonly code: DependencyValidationCode; readonly taskId?: PublicTaskId };

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

type CreateTaskCommandResult = CommandResult<CreateTaskResult>;

export const createTaskCommand = (
  cwd: string,
  input: CreateTaskInput,
): Effect.Effect<CreateTaskCommandResult, RepositoryOperationError> =>
  runRepositoryOperationAt<CreateTaskCommandResult, RepositoryStorageError, never>(
    cwd,
    (context, repository) => {
      const dependsOn = resolveTasks(context, input.dependsOn ?? []);
      if (!Array.isArray(dependsOn)) return Effect.succeed(dependsOn);
      return repository.transactionImmediate("create Task", (sql) =>
        createTaskSqlite(sql, repository.idPrefix, { ...input, dependsOn }),
      );
    },
  );

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

export const createTaskContextDraftCommand = (
  cwd: string,
  taskId: PublicTaskId,
): Effect.Effect<
  CommandResult<{ readonly path: string; readonly content: string } | undefined>,
  RepositoryOperationError
> =>
  runRepositoryOperationAt<
    CommandResult<{ readonly path: string; readonly content: string } | undefined>,
    RepositoryStorageError,
    never
  >(cwd, (context, repository) => {
    const resolved = resolveTask(context, taskId);
    if (typeof resolved !== "string") return Effect.succeed({ ok: false, error: resolved });
    return Effect.flatMap(
      repository.transaction("read Task Context", (sql) =>
        getTaskContextById(sql, resolved, repository.idPrefix),
      ),
      (taskContext) =>
        taskContext === undefined
          ? Effect.succeed(undefined)
          : Effect.try({
              try: () => ({
                ...writeTaskContextDraft(
                  context.paths.taskContextDraftsPath,
                  resolved,
                  taskContext,
                ),
              }),
              catch: (cause) =>
                new RepositoryStateUnavailable({
                  statePath: context.paths.taskContextDraftsPath,
                  cause,
                }),
            }),
    );
  });

export const applyTaskContextDraftCommand = (
  cwd: string,
  input: ApplyTaskContextDraftInput,
): Effect.Effect<CommandResult<ApplyTaskContextDraftResult>, RepositoryOperationError> =>
  runRepositoryOperationAt<
    CommandResult<ApplyTaskContextDraftResult>,
    RepositoryStorageError,
    never
  >(cwd, (context, repository) => {
    const resolved = resolveTask(context, input.taskId);
    if (typeof resolved !== "string") return Effect.succeed({ ok: false, error: resolved });
    const draft = readTaskContextDraft(context.paths.taskContextDraftsPath, resolved);
    if (!draft.ok) {
      return Effect.succeed<CommandResult<ApplyTaskContextDraftResult>>({
        ok: false,
        error: draft.error,
      });
    }
    return Effect.map(
      repository.transactionImmediate("update Task Context", (sql) =>
        updateTaskContext(sql, repository.idPrefix, {
          ...input,
          taskId: resolved,
          description: draft.draft.description,
        }),
      ),
      (result): ApplyTaskContextDraftResult => {
        if (!result.ok) return result;
        if (!removeTaskContextDraft(draft.draft.path)) {
          return {
            ok: false,
            code: "task_context_draft_cleanup_failed",
            task: result.task,
            path: draft.draft.path,
          };
        }
        return result;
      },
    );
  });
