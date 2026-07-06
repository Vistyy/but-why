import { existsSync } from "node:fs";

import {
  loadRepoLocalContext,
  type LoadRepoLocalContextError,
  type RepoLocalContext,
} from "../init/repoContext.js";
import type { RunStore } from "../run/runStore.js";
import { openSqliteRunStore } from "../sqlite/sqliteRunStore.js";
import { openSqliteTaskStore } from "../sqlite/sqliteTaskStore.js";
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

export type LoadTaskUseCasesInput = {
  readonly cwd: string;
  readonly requireState: boolean;
  readonly migrationTimestamp: () => string;
};

export type LoadTaskUseCasesResult =
  | {
      readonly ok: true;
      readonly tasks: TaskUseCases;
    }
  | {
      readonly ok: false;
      readonly error: LoadTaskUseCasesError;
    };

export type LoadTaskUseCasesError =
  | LoadRepoLocalContextError
  | {
      readonly code: "state_store_unavailable";
      readonly taskPrefix: string;
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

export const loadTaskUseCases = (input: LoadTaskUseCasesInput): LoadTaskUseCasesResult => {
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
    tasks: openTaskUseCases(repoContext.context, input.migrationTimestamp),
  };
};

const openTaskUseCases = (
  context: RepoLocalContext,
  migrationTimestamp: () => string,
): TaskUseCases => {
  const taskStore = openSqliteTaskStore({
    statePath: context.paths.statePath,
    taskPrefix: context.taskPrefix,
    migrationTimestamp,
  });
  const runStore = openSqliteRunStore({
    statePath: context.paths.statePath,
    migrationTimestamp,
  });

  return {
    taskPrefix: context.taskPrefix,
    resolveTaskId: (taskId) => resolveRepoTaskId(context, taskId),
    createTask: taskStore.createTask,
    listTasks: taskStore.listTasks,
    listActionableTasks: taskStore.listActionableTasks,
    getTaskById: (taskId) => getTaskById(taskStore, runStore, taskId),
    getTaskContextById: taskStore.getTaskContextById,
    appendTaskComment: taskStore.appendTaskComment,
    startTask: (taskId, now) => startTask(taskStore, runStore, taskId, now),
    transitionTaskState: (input) => transitionTaskState(taskStore, runStore, input),
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
