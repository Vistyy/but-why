import { existsSync } from "node:fs";

import {
  exampleTaskId,
  expectedTaskIdFormat,
  isPublicTaskIdForPrefix,
  loadRepoLocalContext,
  type LoadRepoLocalContextError,
  type RepoLocalContext,
} from "../init/repoContext.js";
import type { TaskContext, TaskRecord, TaskState, TaskSummary } from "./task.js";
import { hasPublicTaskIdShape, type PublicTaskId } from "./taskId.js";
import {
  openDurableTaskState,
  type AppendTaskCommentResult,
  type TaskStateTransitionResult,
} from "./taskStore.js";

/**
 * Task lifecycle commands should enter through this module.
 * Use it for Task lookup, state transitions, Task Context, dashboard actionability, comments, and persistence.
 * CLI files should keep argument parsing and TOON rendering at the edge, then delegate Task behavior here.
 */
export type RepoTaskModule = {
  readonly taskPrefix: string;
  readonly resolveTaskId: (taskId: PublicTaskId) => TaskIdResolution;
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

export type LoadRepoTaskModuleInput = {
  readonly cwd: string;
  readonly requireState: boolean;
};

export type LoadRepoTaskModuleResult =
  | {
      readonly ok: true;
      readonly tasks: RepoTaskModule;
    }
  | {
      readonly ok: false;
      readonly error: LoadRepoTaskModuleError;
    };

export type LoadRepoTaskModuleError =
  | LoadRepoLocalContextError
  | {
      readonly code: "state_store_unavailable";
      readonly taskPrefix: string;
    };

export type TaskIdResolution =
  | {
      readonly ok: true;
      readonly taskId: PublicTaskId;
    }
  | {
      readonly ok: false;
      readonly expectedFormat: string;
      readonly help: string;
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

export const unstartableTaskStates = [
  "validating",
  "needs_input",
  "ready",
  "done",
] as const satisfies readonly TaskState[];

export type UnstartableTaskState = (typeof unstartableTaskStates)[number];

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
      readonly state: UnstartableTaskState;
    };

export const loadRepoTaskModule = (input: LoadRepoTaskModuleInput): LoadRepoTaskModuleResult => {
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
    tasks: repoTaskModule(repoContext.context),
  };
};

const repoTaskModule = (context: RepoLocalContext): RepoTaskModule => {
  const state = openDurableTaskState({
    statePath: context.paths.statePath,
    taskPrefix: context.taskPrefix,
  });

  return {
    taskPrefix: context.taskPrefix,
    resolveTaskId: (taskId) => resolveTaskIdForContext(context, taskId),
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
  transitionTaskState: RepoTaskModule["transitionTaskState"],
  taskId: PublicTaskId,
  now: string,
): StartTaskResult => {
  const result = transitionTaskState({ taskId, to: "implementing", now });

  if (result.ok) {
    return result;
  }

  if (result.code === "invalid_task_state_transition") {
    if (!isUnstartableTaskState(result.from)) {
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

const unstartableTaskStateSet = new Set<TaskState>(unstartableTaskStates);

const isUnstartableTaskState = (state: TaskState): state is UnstartableTaskState =>
  unstartableTaskStateSet.has(state);

const resolveTaskIdForContext = (
  context: RepoLocalContext,
  taskId: PublicTaskId,
): TaskIdResolution => {
  if (!hasPublicTaskIdShape(taskId) || !isPublicTaskIdForPrefix(taskId, context.taskPrefix)) {
    return {
      ok: false,
      expectedFormat: expectedTaskIdFormat(context.taskPrefix),
      help: `Use a public Task ID such as ${exampleTaskId(context.taskPrefix)}.`,
    };
  }

  return { ok: true, taskId };
};
