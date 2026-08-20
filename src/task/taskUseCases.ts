import { Effect } from "effect";
import {
  RepositoryStateUnavailable,
  type RepositoryStorageError,
} from "../contracts/repositoryStorageError.js";
import type { LocalRepositoryContext } from "../repositoryRuntime/repositoryContext.js";
import {
  readTaskContextDraft,
  removeTaskContextDraft,
  type TaskContextDraftReadError,
  writeTaskContextDraft,
} from "./files/contextDraft.js";
import type { TaskState } from "./lifecycle.js";
import { type RepoTaskIdResolution, resolveRepoTaskId } from "./repoTaskIds.js";
import type { TaskContext, TaskRecord, TaskSummary } from "./task.js";
import type { PublicTaskId } from "./taskId.js";
import type { CreateTaskPersistenceResult, TaskPersistence } from "./taskPersistence.js";
import type {
  CreateTaskInput,
  EditTaskDependenciesInput,
  EditTaskDependenciesResult,
  ListTasksInput,
  ListTasksResult,
  ReviseTaskInput,
  ReviseTaskResult,
} from "./taskStore.js";

export type TaskUseCases = {
  readonly idPrefix: string;
  readonly resolveTaskId: (taskId: PublicTaskId) => RepoTaskIdResolution;
  readonly createTask: (
    input: CreateTaskInput,
  ) => Effect.Effect<CreateTaskPersistenceResult, RepositoryStorageError>;
  readonly editTaskDependencies: (
    input: EditTaskDependenciesInput,
  ) => Effect.Effect<RepoEditTaskDependenciesResult, RepositoryStorageError>;
  readonly listTasks: (
    input: ListTasksInput,
  ) => Effect.Effect<ListTasksResult, RepositoryStorageError>;
  readonly listActionableTasks: () => Effect.Effect<readonly TaskSummary[], RepositoryStorageError>;
  readonly getTaskById: (
    taskId: PublicTaskId,
  ) => Effect.Effect<TaskRecord | undefined, RepositoryStorageError>;
  readonly getTaskForInspection: (
    taskId: PublicTaskId,
  ) => Effect.Effect<TaskRecord | undefined, RepositoryStorageError>;
  readonly getTaskContextById: (
    taskId: PublicTaskId,
  ) => Effect.Effect<TaskContext | undefined, RepositoryStorageError>;
  readonly createTaskContextDraft: (
    taskId: PublicTaskId,
  ) => Effect.Effect<TaskContextDraft | undefined, RepositoryStorageError>;
  readonly applyTaskContextDraft: (
    input: ApplyTaskContextDraftInput,
  ) => Effect.Effect<ApplyTaskContextDraftResult, RepositoryStorageError>;
  readonly reviseTask: (
    input: ReviseTaskInput,
  ) => Effect.Effect<ReviseTaskResult, RepositoryStorageError>;
};

export type TaskContextDraft = { readonly path: string; readonly content: string };

export type ApplyTaskContextDraftInput = {
  readonly taskId: PublicTaskId;
  readonly now: string;
};

export type ApplyTaskContextDraftResult =
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

export type RepoEditTaskDependenciesResult = EditTaskDependenciesResult;

export const openTaskUseCases = (
  context: LocalRepositoryContext,
  tasks: TaskPersistence,
): TaskUseCases => ({
  idPrefix: context.idPrefix,
  resolveTaskId: (taskId) => resolveRepoTaskId(context, taskId),
  createTask: tasks.createTask,
  editTaskDependencies: (input) => tasks.editTaskDependencies(input),
  listTasks: tasks.listTasks,
  listActionableTasks: tasks.listActionableTasks,
  getTaskById: tasks.getTaskById,
  getTaskForInspection: tasks.getTaskById,
  getTaskContextById: tasks.getTaskContextById,
  createTaskContextDraft: (taskId) => createTaskContextDraft(context, tasks, taskId),
  applyTaskContextDraft: (input) => applyTaskContextDraft(context, tasks, input),
  reviseTask: tasks.reviseTask,
});

const createTaskContextDraft = (
  context: LocalRepositoryContext,
  tasks: TaskPersistence,
  taskId: PublicTaskId,
): Effect.Effect<TaskContextDraft | undefined, RepositoryStorageError> =>
  Effect.flatMap(tasks.getTaskContextById(taskId), (taskContext) =>
    taskContext === undefined
      ? Effect.succeed(undefined)
      : Effect.try({
          try: () => ({
            ...writeTaskContextDraft(context.paths.taskContextDraftsPath, taskId, taskContext),
          }),
          catch: (cause) =>
            new RepositoryStateUnavailable({
              statePath: context.paths.taskContextDraftsPath,
              cause,
            }),
        }),
  );

const applyTaskContextDraft = (
  context: LocalRepositoryContext,
  tasks: TaskPersistence,
  input: ApplyTaskContextDraftInput,
): Effect.Effect<ApplyTaskContextDraftResult, RepositoryStorageError> => {
  const draft = readTaskContextDraft(context.paths.taskContextDraftsPath, input.taskId);
  if (!draft.ok) return Effect.succeed({ ok: false, error: draft.error });

  return Effect.map(
    tasks.updateTaskContext({
      taskId: input.taskId,
      description: draft.draft.description,
      now: input.now,
    }),
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
};
