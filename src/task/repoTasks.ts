import { existsSync } from "node:fs";

import {
  loadRepoLocalContext,
  type LoadRepoLocalContextError,
  type RepoLocalContext,
} from "../init/repoContext.js";
import { canStartFrom, type StartIneligibleState } from "./startPolicy.js";
import type { TaskState } from "./lifecycle.js";
import type { TaskContext, TaskRecord, TaskSummary } from "./task.js";
import { resolveRepoTaskId, type RepoTaskIdResolution } from "./repoTaskIds.js";
import type { PublicTaskId } from "./taskId.js";
import {
  openRepoState,
  type AppendTaskCommentResult,
  type TaskStateTransitionResult,
} from "../repoState.js";

/**
 * Task lifecycle commands should enter through this module.
 * Use it for Task lookup, state transitions, Task Context, dashboard actionability, comments, and persistence.
 * CLI files should keep argument parsing and stdout formatting at the edge, then delegate Task behavior here.
 */
export type RepoTasks = {
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
  readonly transitionTaskState: (input: TransitionTaskStateInput) => TaskStateTransitionResult;
};

export type LoadRepoTasksInput = {
  readonly cwd: string;
  readonly requireState: boolean;
};

export type LoadRepoTasksResult =
  | {
      readonly ok: true;
      readonly tasks: RepoTasks;
    }
  | {
      readonly ok: false;
      readonly error: LoadRepoTasksError;
    };

export type LoadRepoTasksError =
  | LoadRepoLocalContextError
  | {
      readonly code: "state_store_unavailable";
      readonly taskPrefix: string;
    };

export type CreateTaskInput = {
  readonly title: string;
  readonly description: string;
  readonly now: string;
};

export type ListTasksInput = {
  readonly includeDone: boolean;
  readonly state?: TaskState;
};

export type AppendTaskCommentInput = {
  readonly taskId: PublicTaskId;
  readonly content: string;
  readonly now: () => string;
};

export type TransitionTaskStateInput = {
  readonly taskId: PublicTaskId;
  readonly to: TaskState;
  readonly now: string;
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

export const loadRepoTasks = (input: LoadRepoTasksInput): LoadRepoTasksResult => {
  const repoContext = loadRepoLocalContext(input.cwd);

  if (!repoContext.ok) {
    return repoContext;
  }

  if (input.requireState && !existsSync(repoContext.context.paths.statePath)) {
    return {
      ok: false,
      error: {
        code: "state_store_unavailable",
        taskPrefix: repoContext.context.taskPrefix,
      },
    };
  }

  return {
    ok: true,
    tasks: repoTasks(repoContext.context),
  };
};

const repoTasks = (context: RepoLocalContext): RepoTasks => {
  const state = openRepoState({
    statePath: context.paths.statePath,
    taskPrefix: context.taskPrefix,
  });

  return {
    taskPrefix: context.taskPrefix,
    resolveTaskId: (taskId) => resolveRepoTaskId(context, taskId),
    createTask: state.createTask,
    listTasks: state.listTasks,
    listActionableTasks: state.listActionableTasks,
    getTaskById: state.getTaskById,
    getTaskContextById: state.getTaskContextById,
    appendTaskComment: state.appendTaskComment,
    startTask: (taskId, now) => startTask(state.transitionTaskState, taskId, now),
    transitionTaskState: state.transitionTaskState,
  };
};

const startTask = (
  transitionTaskState: RepoTasks["transitionTaskState"],
  taskId: PublicTaskId,
  now: string,
): StartTaskResult => {
  const result = transitionTaskState({ taskId, to: "implementing", now });

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
