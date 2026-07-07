import type { RepoLocalContext } from "../init/repoContext.js";
import type { RunStore } from "../run/runStore.js";
import { canStartFrom, type StartIneligibleState } from "./startPolicy.js";
import type { TaskState } from "./lifecycle.js";
import type { TaskContext, TaskRecord, TaskSummary } from "./task.js";
import { resolveRepoTaskId, type RepoTaskIdResolution } from "./repoTaskIds.js";
import type { PublicTaskId } from "./taskId.js";
import type { AppendTaskCommentResult, StoredTaskRecord, TaskStore } from "./taskStore.js";

/**
 * Task lifecycle commands should enter through this module.
 * Use it for Task lookup, state transitions, Task Context, dashboard actionability, comments, and persistence.
 * CLI files should keep argument parsing and stdout formatting at the edge, then delegate Task behavior here.
 */
export type TaskUseCases = {
  readonly taskPrefix: string;
  readonly resolveTaskId: (taskId: PublicTaskId) => RepoTaskIdResolution;
  readonly createTask: (input: CreateTaskInput) => TaskSummary;
  readonly listTasks: (input: ListTasksInput) => readonly TaskSummary[];
  readonly listActionableTasks: () => readonly TaskSummary[];
  readonly getTaskById: (taskId: PublicTaskId) => TaskRecord | undefined;
  readonly getTaskContextById: (taskId: PublicTaskId) => TaskContext | undefined;
  readonly appendTaskComment: (
    input: AppendTaskCommentInput,
  ) => AppendTaskCommentResult | undefined;
  readonly startTask: (taskId: PublicTaskId, now: string) => StartTaskResult;
  readonly transitionTaskState: (input: TransitionTaskStateInput) => RepoTaskStateTransitionResult;
};

type CreateTaskInput = {
  readonly title: string;
  readonly description: string;
  readonly now: string;
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

export type RepoTaskStateTransitionResult =
  | {
      readonly ok: true;
      readonly changed: boolean;
      readonly task: TaskRecord;
    }
  | {
      readonly ok: false;
      readonly code: "task_not_found";
    }
  | {
      readonly ok: false;
      readonly code: "invalid_task_state_transition";
      readonly from: TaskState;
      readonly to: TaskState;
    };

export type StartTaskResult =
  | {
      readonly ok: true;
      readonly changed: boolean;
      readonly task: TaskRecord;
    }
  | {
      readonly ok: false;
      readonly code: "task_not_found";
    }
  | {
      readonly ok: false;
      readonly code: "invalid_task_state";
      readonly state: StartIneligibleState;
    };

export const openTaskUseCases = (
  context: RepoLocalContext,
  stores: {
    readonly taskStore: TaskStore;
    readonly runStore: RunStore;
  },
): TaskUseCases => {
  return {
    taskPrefix: context.taskPrefix,
    resolveTaskId: (taskId) => resolveRepoTaskId(context, taskId),
    createTask: stores.taskStore.createTask,
    listTasks: stores.taskStore.listTasks,
    listActionableTasks: stores.taskStore.listActionableTasks,
    getTaskById: (taskId) => getTaskById(stores.taskStore, stores.runStore, taskId),
    getTaskContextById: stores.taskStore.getTaskContextById,
    appendTaskComment: stores.taskStore.appendTaskComment,
    startTask: (taskId, now) => startTask(stores.taskStore, stores.runStore, taskId, now),
    transitionTaskState: (input) => transitionTaskState(stores.taskStore, stores.runStore, input),
  };
};

const getTaskById = (
  taskStore: TaskStore,
  runStore: RunStore,
  taskId: PublicTaskId,
): TaskRecord | undefined => {
  const task = taskStore.getTaskById(taskId);

  if (task === undefined) {
    return undefined;
  }

  return withLatestRun(task, runStore.getLatestRunIdForTask(taskId));
};

const transitionTaskState = (
  taskStore: TaskStore,
  runStore: RunStore,
  input: TransitionTaskStateInput,
): RepoTaskStateTransitionResult => {
  const result = taskStore.transitionTaskState(input);

  if (!result.ok) {
    return result;
  }

  return {
    ...result,
    task: withLatestRun(result.task, runStore.getLatestRunIdForTask(input.taskId)),
  };
};

const withLatestRun = (task: StoredTaskRecord, latestRun: string | null): TaskRecord => ({
  ...task,
  latestRun,
});

const startTask = (
  taskStore: TaskStore,
  runStore: RunStore,
  taskId: PublicTaskId,
  now: string,
): StartTaskResult => {
  const result = transitionTaskState(taskStore, runStore, {
    taskId,
    to: "implementing",
    now,
  });

  if (result.ok) {
    return result;
  }

  if (result.code === "invalid_task_state_transition") {
    if (canStartFrom(result.from)) {
      throw new Error(`Unexpected invalid Task start from ${result.from}`);
    }

    return {
      ok: false,
      code: "invalid_task_state",
      state: result.from,
    };
  }

  return result;
};
