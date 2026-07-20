import type { RepoLocalContext } from "../init/repoContext.js";
import {
  readTaskContextDraft,
  removeTaskContextDraft,
  writeTaskContextDraft,
  type TaskContextDraftReadError,
} from "./files/contextDraft.js";
import type { TaskState } from "./lifecycle.js";
import type { TaskContext, TaskRecord, TaskSummary } from "./task.js";
import { resolveRepoTaskId, type RepoTaskIdResolution } from "./repoTaskIds.js";
import type { PublicTaskId } from "./taskId.js";
import type { AppendTaskCommentResult, TaskApprovalResult, TaskStore } from "./taskStore.js";

export type TaskUseCases = {
  readonly taskPrefix: string;
  readonly resolveTaskId: (taskId: PublicTaskId) => RepoTaskIdResolution;
  readonly createTask: (input: CreateTaskInput) => TaskSummary;
  readonly replaceTaskDependencies: (
    taskId: PublicTaskId,
    prerequisiteTaskIds: readonly PublicTaskId[],
  ) => RepoReplaceTaskDependenciesResult;
  readonly listTasks: (input: ListTasksInput) => readonly TaskSummary[];
  readonly listActionableTasks: () => readonly TaskSummary[];
  readonly getTaskById: (taskId: PublicTaskId) => TaskRecord | undefined;
  readonly getTaskForInspection: (taskId: PublicTaskId) => TaskRecord | undefined;
  readonly getTaskContextById: (taskId: PublicTaskId) => TaskContext | undefined;
  readonly createTaskContextDraft: (taskId: PublicTaskId) => TaskContextDraft | undefined;
  readonly applyTaskContextDraft: (
    input: ApplyTaskContextDraftInput,
  ) => ApplyTaskContextDraftResult;
  readonly approveTask: (taskId: PublicTaskId, now: string) => RepoTaskApprovalResult;
  readonly appendTaskComment: (input: AppendTaskCommentInput) => AppendTaskCommentResult;
  readonly transitionTaskState: (input: TransitionTaskStateInput) => RepoTaskStateTransitionResult;
};

type CreateTaskInput = {
  readonly title: string;
  readonly description: string;
  readonly now: string;
  readonly dependsOn?: readonly PublicTaskId[];
};

type ListTasksInput = {
  readonly includeDone: boolean;
  readonly state?: TaskState;
};

type AppendTaskCommentInput = {
  readonly taskId: PublicTaskId;
  readonly content: string;
  readonly now: () => string;
};

type TransitionTaskStateInput = {
  readonly taskId: PublicTaskId;
  readonly to: TaskState;
  readonly now: string;
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

export type RepoTaskStateTransitionResult = ReturnType<TaskStore["transitionTaskState"]>;
export type RepoTaskApprovalResult = TaskApprovalResult;
export type RepoReplaceTaskDependenciesResult = ReturnType<TaskStore["replaceTaskDependencies"]>;

export const openTaskUseCases = (
  context: RepoLocalContext,
  stores: { readonly taskStore: TaskStore },
): TaskUseCases => ({
  taskPrefix: context.taskPrefix,
  resolveTaskId: (taskId) => resolveRepoTaskId(context, taskId),
  createTask: stores.taskStore.createTask,
  replaceTaskDependencies: (taskId, prerequisiteTaskIds) =>
    stores.taskStore.replaceTaskDependencies({ taskId, prerequisiteTaskIds }),
  listTasks: stores.taskStore.listTasks,
  listActionableTasks: stores.taskStore.listActionableTasks,
  getTaskById: stores.taskStore.getTaskById,
  getTaskForInspection: stores.taskStore.getTaskById,
  getTaskContextById: stores.taskStore.getTaskContextById,
  createTaskContextDraft: (taskId) => createTaskContextDraft(context, stores.taskStore, taskId),
  applyTaskContextDraft: (input) => applyTaskContextDraft(context, stores.taskStore, input),
  approveTask: (taskId, now) => stores.taskStore.approveTask({ taskId, now }),
  appendTaskComment: stores.taskStore.appendTaskComment,
  transitionTaskState: stores.taskStore.transitionTaskState,
});

const createTaskContextDraft = (
  context: RepoLocalContext,
  taskStore: TaskStore,
  taskId: PublicTaskId,
): TaskContextDraft | undefined => {
  const taskContext = taskStore.getTaskContextById(taskId);
  return taskContext === undefined
    ? undefined
    : { path: writeTaskContextDraft(context.paths.taskContextDraftsPath, taskId, taskContext) };
};

const applyTaskContextDraft = (
  context: RepoLocalContext,
  taskStore: TaskStore,
  input: ApplyTaskContextDraftInput,
): ApplyTaskContextDraftResult => {
  const draft = readTaskContextDraft(context.paths.taskContextDraftsPath, input.taskId);
  if (!draft.ok) return { ok: false, error: draft.error };

  const result = taskStore.updateTaskContext({
    taskId: input.taskId,
    title: draft.draft.title,
    description: draft.draft.description,
    now: input.now,
  });
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
};
