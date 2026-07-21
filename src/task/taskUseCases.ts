import { Effect } from "effect";

import type { RepoLocalContext } from "../init/repoContext.js";
import type { RepositoryStorageError } from "../repositoryStorageError.js";
import {
  readTaskContextDraft,
  removeTaskContextDraft,
  writeTaskContextDraft,
  type TaskContextDraftReadError,
} from "./files/contextDraft.js";
import type { TaskState } from "./lifecycle.js";
import type { TaskContext, TaskRecord, TaskSummary } from "./task.js";
import type { CreateTaskPersistenceResult, TaskPersistence } from "./taskPersistence.js";
import { resolveRepoTaskId, type RepoTaskIdResolution } from "./repoTaskIds.js";
import type { PublicTaskId } from "./taskId.js";
import type {
  AppendTaskCommentInput,
  AppendTaskCommentResult,
  CreateTaskInput,
  ListTasksInput,
  ReplaceTaskDependenciesResult,
  TaskApprovalResult,
  TaskStateTransitionResult,
  TransitionTaskStateInput,
} from "./taskStore.js";

export type TaskUseCases = {
  readonly taskPrefix: string;
  readonly resolveTaskId: (taskId: PublicTaskId) => RepoTaskIdResolution;
  readonly createTask: (
    input: CreateTaskInput,
  ) => Effect.Effect<CreateTaskPersistenceResult, RepositoryStorageError>;
  readonly replaceTaskDependencies: (
    taskId: PublicTaskId,
    prerequisiteTaskIds: readonly PublicTaskId[],
  ) => Effect.Effect<RepoReplaceTaskDependenciesResult, RepositoryStorageError>;
  readonly listTasks: (
    input: ListTasksInput,
  ) => Effect.Effect<readonly TaskSummary[], RepositoryStorageError>;
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
  readonly approveTask: (
    taskId: PublicTaskId,
    now: string,
  ) => Effect.Effect<RepoTaskApprovalResult, RepositoryStorageError>;
  readonly appendTaskComment: (
    input: AppendTaskCommentInput,
  ) => Effect.Effect<AppendTaskCommentResult, RepositoryStorageError>;
  readonly transitionTaskState: (
    input: TransitionTaskStateInput,
  ) => Effect.Effect<RepoTaskStateTransitionResult, RepositoryStorageError>;
};

export type TaskContextDraft = { readonly path: string };

export type ApplyTaskContextDraftInput = {
  readonly taskId: PublicTaskId;
  readonly now: string;
};

export type ApplyTaskContextDraftResult =
  | { readonly ok: true; readonly task: TaskRecord }
  | { readonly ok: false; readonly code: "task_not_found" }
  | { readonly ok: false; readonly code: "invalid_task_state"; readonly state: TaskState }
  | { readonly ok: false; readonly error: TaskContextDraftReadError }
  | {
      readonly ok: false;
      readonly code: "task_context_draft_cleanup_failed";
      readonly task: TaskRecord;
      readonly path: string;
    };

export type RepoTaskStateTransitionResult = TaskStateTransitionResult;
export type RepoTaskApprovalResult = TaskApprovalResult;
export type RepoReplaceTaskDependenciesResult = ReplaceTaskDependenciesResult;

export const openTaskUseCases = (
  context: RepoLocalContext,
  tasks: TaskPersistence,
): TaskUseCases => ({
  taskPrefix: context.taskPrefix,
  resolveTaskId: (taskId) => resolveRepoTaskId(context, taskId),
  createTask: tasks.createTask,
  replaceTaskDependencies: (taskId, prerequisiteTaskIds) =>
    tasks.replaceTaskDependencies({ taskId, prerequisiteTaskIds }),
  listTasks: tasks.listTasks,
  listActionableTasks: tasks.listActionableTasks,
  getTaskById: tasks.getTaskById,
  getTaskForInspection: tasks.getTaskById,
  getTaskContextById: tasks.getTaskContextById,
  createTaskContextDraft: (taskId) => createTaskContextDraft(context, tasks, taskId),
  applyTaskContextDraft: (input) => applyTaskContextDraft(context, tasks, input),
  approveTask: (taskId, now) => tasks.approveTask({ taskId, now }),
  appendTaskComment: tasks.appendTaskComment,
  transitionTaskState: tasks.transitionTaskState,
});

const createTaskContextDraft = (
  context: RepoLocalContext,
  tasks: TaskPersistence,
  taskId: PublicTaskId,
): Effect.Effect<TaskContextDraft | undefined, RepositoryStorageError> =>
  Effect.map(tasks.getTaskContextById(taskId), (taskContext) =>
    taskContext === undefined
      ? undefined
      : {
          path: writeTaskContextDraft(context.paths.taskContextDraftsPath, taskId, taskContext),
        },
  );

const applyTaskContextDraft = (
  context: RepoLocalContext,
  tasks: TaskPersistence,
  input: ApplyTaskContextDraftInput,
): Effect.Effect<ApplyTaskContextDraftResult, RepositoryStorageError> => {
  const draft = readTaskContextDraft(context.paths.taskContextDraftsPath, input.taskId);
  if (!draft.ok) return Effect.succeed({ ok: false, error: draft.error });

  return Effect.map(
    tasks.updateTaskContext({
      taskId: input.taskId,
      title: draft.draft.title,
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
