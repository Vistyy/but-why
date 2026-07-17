import type { RepoLocalContext } from "../init/repoContext.js";
import {
  readTaskContextDraft,
  removeTaskContextDraft,
  writeTaskContextDraft,
  type TaskContextDraftReadError,
} from "./files/contextDraft.js";
import type {
  ValidationRunFindingRecord,
  ValidationRunRecord,
} from "../validationRun/validationRun.js";
import type {
  ValidationRunStore,
  ValidationRunSummaryRecord,
  ValidationRunToolingErrorRecord,
} from "../validationRun/validationRunStore.js";
import { canStartFrom, type StartIneligibleState } from "./startPolicy.js";
import type { TaskState } from "./lifecycle.js";
import type { TaskContext, TaskRecord, TaskSummary } from "./task.js";
import { resolveRepoTaskId, type RepoTaskIdResolution } from "./repoTaskIds.js";
import type { PublicTaskId } from "./taskId.js";
import type {
  AppendTaskCommentResult,
  StoredTaskRecord,
  TaskApprovalResult,
  TaskStore,
} from "./taskStore.js";

/**
 * Task lifecycle commands should enter through this module.
 * Use it for Task lookup, state transitions, Task Context, dashboard actionability, comments, and persistence.
 * CLI files should keep argument parsing and stdout formatting at the edge, then delegate Task behavior here.
 */
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
  readonly getLatestTaskValidationFindings: (
    taskId: PublicTaskId,
  ) => TaskLatestValidationFindings | undefined;
  readonly listTaskValidationRuns: (taskId: PublicTaskId) => TaskValidationRunHistory | undefined;
  readonly getTaskContextById: (taskId: PublicTaskId) => TaskContext | undefined;
  readonly createTaskContextDraft: (taskId: PublicTaskId) => TaskContextDraft | undefined;
  readonly applyTaskContextDraft: (
    input: ApplyTaskContextDraftInput,
  ) => ApplyTaskContextDraftResult;
  readonly approveTask: (taskId: PublicTaskId, now: string) => RepoTaskApprovalResult;
  readonly appendTaskComment: (input: AppendTaskCommentInput) => AppendTaskCommentResult;
  readonly startTask: (taskId: PublicTaskId, now: string) => StartTaskResult;
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

export type TaskContextDraft = {
  readonly path: string;
};

export type ApplyTaskContextDraftInput = {
  readonly taskId: PublicTaskId;
  readonly now: string;
};

export type ApplyTaskContextDraftResult =
  | {
      readonly ok: true;
      readonly task: TaskRecord;
    }
  | {
      readonly ok: false;
      readonly code: "task_not_found";
    }
  | {
      readonly ok: false;
      readonly code: "invalid_task_state";
      readonly state: TaskState;
    }
  | {
      readonly ok: false;
      readonly error: TaskContextDraftReadError;
    }
  | {
      readonly ok: false;
      readonly code: "task_context_draft_cleanup_failed";
      readonly task: TaskRecord;
      readonly path: string;
    };

export type TaskLatestValidationFindings = {
  readonly task: TaskRecord;
  readonly validationRun: ValidationRunRecord | null;
  readonly findings: readonly ValidationRunFindingRecord[];
  readonly toolingFailures: readonly ValidationRunToolingErrorRecord[];
};

export type TaskValidationRunHistory = {
  readonly task: TaskRecord;
  readonly validationRuns: readonly ValidationRunSummaryRecord[];
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
    }
  | Extract<
      ReturnType<TaskStore["transitionTaskState"]>,
      { readonly code: "task_dependencies_unsatisfied" }
    >;

export type RepoTaskApprovalResult =
  | {
      readonly ok: true;
      readonly changed: boolean;
      readonly task: TaskRecord;
    }
  | Exclude<TaskApprovalResult, { readonly ok: true }>;

export type RepoReplaceTaskDependenciesResult =
  | { readonly ok: true; readonly task: TaskRecord }
  | Exclude<ReturnType<TaskStore["replaceTaskDependencies"]>, { readonly ok: true }>;

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
    }
  | Extract<
      ReturnType<TaskStore["transitionTaskState"]>,
      { readonly code: "task_dependencies_unsatisfied" }
    >;

export const openTaskUseCases = (
  context: RepoLocalContext,
  stores: {
    readonly taskStore: TaskStore;
    readonly validationRunStore: ValidationRunStore;
  },
): TaskUseCases => {
  return {
    taskPrefix: context.taskPrefix,
    resolveTaskId: (taskId) => resolveRepoTaskId(context, taskId),
    createTask: stores.taskStore.createTask,
    replaceTaskDependencies: (taskId, prerequisiteTaskIds) => {
      const result = stores.taskStore.replaceTaskDependencies({ taskId, prerequisiteTaskIds });
      return result.ok
        ? {
            ok: true,
            task: withLatestValidationRun(
              result.task,
              stores.validationRunStore.getLatestValidationRunIdForTask(taskId),
            ),
          }
        : result;
    },
    listTasks: stores.taskStore.listTasks,
    listActionableTasks: stores.taskStore.listActionableTasks,
    getTaskById: (taskId) => getTaskById(stores.taskStore, stores.validationRunStore, taskId),
    getLatestTaskValidationFindings: (taskId) =>
      getLatestTaskValidationFindings(stores.taskStore, stores.validationRunStore, taskId),
    listTaskValidationRuns: (taskId) =>
      listTaskValidationRuns(stores.taskStore, stores.validationRunStore, taskId),
    getTaskContextById: stores.taskStore.getTaskContextById,
    createTaskContextDraft: (taskId) => createTaskContextDraft(context, stores.taskStore, taskId),
    applyTaskContextDraft: (input) =>
      applyTaskContextDraft(context, stores.taskStore, stores.validationRunStore, input),
    approveTask: (taskId, now) =>
      approveTask(stores.taskStore, stores.validationRunStore, taskId, now),
    appendTaskComment: stores.taskStore.appendTaskComment,
    startTask: (taskId, now) => startTask(stores.taskStore, stores.validationRunStore, taskId, now),
    transitionTaskState: (input) =>
      transitionTaskState(stores.taskStore, stores.validationRunStore, input),
  };
};

const createTaskContextDraft = (
  context: RepoLocalContext,
  taskStore: TaskStore,
  taskId: PublicTaskId,
): TaskContextDraft | undefined => {
  const taskContext = taskStore.getTaskContextById(taskId);

  if (taskContext === undefined) {
    return undefined;
  }

  return {
    path: writeTaskContextDraft(context.paths.taskContextDraftsPath, taskId, taskContext),
  };
};

const applyTaskContextDraft = (
  context: RepoLocalContext,
  taskStore: TaskStore,
  validationRunStore: ValidationRunStore,
  input: ApplyTaskContextDraftInput,
): ApplyTaskContextDraftResult => {
  const draft = readTaskContextDraft(context.paths.taskContextDraftsPath, input.taskId);

  if (!draft.ok) {
    return { ok: false, error: draft.error };
  }

  const result = taskStore.updateTaskContext({
    taskId: input.taskId,
    title: draft.draft.title,
    description: draft.draft.description,
    now: input.now,
  });

  if (!result.ok) {
    return result;
  }

  const task = withLatestValidationRun(
    result.task,
    validationRunStore.getLatestValidationRunIdForTask(input.taskId),
  );

  if (!removeTaskContextDraft(draft.draft.path)) {
    return {
      ok: false,
      code: "task_context_draft_cleanup_failed",
      task,
      path: draft.draft.path,
    };
  }

  return { ok: true, task };
};

const getTaskById = (
  taskStore: TaskStore,
  validationRunStore: ValidationRunStore,
  taskId: PublicTaskId,
): TaskRecord | undefined => {
  const task = taskStore.getTaskById(taskId);

  if (task === undefined) {
    return undefined;
  }

  return withLatestValidationRun(task, validationRunStore.getLatestValidationRunIdForTask(taskId));
};

const getLatestTaskValidationFindings = (
  taskStore: TaskStore,
  validationRunStore: ValidationRunStore,
  taskId: PublicTaskId,
): TaskLatestValidationFindings | undefined => {
  const task = getTaskById(taskStore, validationRunStore, taskId);

  if (task === undefined) {
    return undefined;
  }

  if (task.latestValidationRun === null) {
    return {
      task,
      validationRun: null,
      findings: [],
      toolingFailures: [],
    };
  }

  const validationRun = validationRunStore.getValidationRunById(task.latestValidationRun);

  if (validationRun === undefined) {
    throw new Error(`Latest Validation Run was not found: ${task.latestValidationRun}`);
  }

  return {
    task,
    validationRun,
    findings: validationRunStore.listValidationRunFindings(validationRun.id),
    toolingFailures: validationRunStore.listValidationRunToolingErrors(validationRun.id),
  };
};

const listTaskValidationRuns = (
  taskStore: TaskStore,
  validationRunStore: ValidationRunStore,
  taskId: PublicTaskId,
): TaskValidationRunHistory | undefined => {
  const task = getTaskById(taskStore, validationRunStore, taskId);

  if (task === undefined) {
    return undefined;
  }

  return {
    task,
    validationRuns: validationRunStore.listValidationRunSummariesForTask(taskId),
  };
};

const transitionTaskState = (
  taskStore: TaskStore,
  validationRunStore: ValidationRunStore,
  input: TransitionTaskStateInput,
): RepoTaskStateTransitionResult => {
  const result = taskStore.transitionTaskState(input);

  if (!result.ok) {
    return result;
  }

  return {
    ...result,
    task: withLatestValidationRun(
      result.task,
      validationRunStore.getLatestValidationRunIdForTask(input.taskId),
    ),
  };
};

const approveTask = (
  taskStore: TaskStore,
  validationRunStore: ValidationRunStore,
  taskId: PublicTaskId,
  now: string,
): RepoTaskApprovalResult => {
  const result = taskStore.approveTask({ taskId, now });

  if (!result.ok) {
    return result;
  }

  return {
    ...result,
    task: withLatestValidationRun(
      result.task,
      validationRunStore.getLatestValidationRunIdForTask(taskId),
    ),
  };
};

const withLatestValidationRun = (
  task: StoredTaskRecord,
  latestValidationRun: string | null,
): TaskRecord => ({
  ...task,
  latestValidationRun,
});

const startTask = (
  taskStore: TaskStore,
  validationRunStore: ValidationRunStore,
  taskId: PublicTaskId,
  now: string,
): StartTaskResult => {
  const result = transitionTaskState(taskStore, validationRunStore, {
    taskId,
    to: "implementing",
    now,
  });

  if (result.ok) {
    return result;
  }

  if (result.code === "task_dependencies_unsatisfied") {
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
