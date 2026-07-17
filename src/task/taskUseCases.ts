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
import type { TaskState } from "./lifecycle.js";
import { provisionTaskWorktree, resolveTaskStartGitIntent } from "../taskStart/taskStartGit.js";
import type { TaskStartStore } from "../taskStart/taskStartStore.js";
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
      readonly changeId: string;
      readonly branchRef: string;
      readonly startingCommit: string;
      readonly worktreePath: string;
    }
  | { readonly ok: false; readonly code: "task_not_found" }
  | { readonly ok: false; readonly code: "invalid_task_state"; readonly state: TaskState }
  | Extract<
      ReturnType<TaskStore["transitionTaskState"]>,
      { readonly code: "task_dependencies_unsatisfied" }
    >
  | {
      readonly ok: false;
      readonly code:
        | "local_default_branch_missing"
        | "local_default_branch_ambiguous"
        | "local_default_branch_unavailable"
        | "committed_repo_config_missing"
        | "committed_repo_config_invalid"
        | "task_start_conflict"
        | "git_tooling_error";
      readonly changeId?: string;
      readonly branchRef?: string;
      readonly startingCommit?: string;
      readonly worktreePath?: string;
    };

export const openTaskUseCases = (
  context: RepoLocalContext,
  stores: {
    readonly taskStore: TaskStore;
    readonly taskStartStore: TaskStartStore;
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
    startTask: (taskId, now) =>
      startTask(
        context,
        stores.taskStore,
        stores.taskStartStore,
        stores.validationRunStore,
        taskId,
        now,
      ),
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
  context: RepoLocalContext,
  taskStore: TaskStore,
  taskStartStore: TaskStartStore,
  validationRunStore: ValidationRunStore,
  taskId: PublicTaskId,
  now: string,
): StartTaskResult => {
  const existing = taskStartStore.getByTaskId(taskId);
  let changed = false;
  let start = existing;

  if (start === undefined) {
    const task = taskStore.getTaskById(taskId);
    if (task === undefined) return { ok: false, code: "task_not_found" };
    if (task.state !== "todo") {
      return { ok: false, code: "invalid_task_state", state: task.state };
    }
    if (task.blockedBy.length > 0) {
      return { ok: false, code: "task_dependencies_unsatisfied", blockedBy: task.blockedBy };
    }

    const gitIntent = resolveTaskStartGitIntent(context, taskId);
    if (!gitIntent.ok) return gitIntent;

    const bound = taskStartStore.bind({
      taskId,
      ...gitIntent.intent,
      now,
    });
    if (!bound.ok) return bound;
    changed = bound.changed;
    start = bound.start;
  }

  const provisioned = provisionTaskWorktree(
    context.root,
    start,
    existing !== undefined || !changed,
  );
  if (!provisioned.ok) {
    return {
      ...provisioned,
      changeId: start.changeId,
      branchRef: start.branchRef,
      startingCommit: start.startingCommit,
      worktreePath: start.worktreePath,
    };
  }
  if (start.provisioningState !== "ready") {
    start = taskStartStore.markReady(taskId, now);
  }

  const task = getTaskById(taskStore, validationRunStore, taskId);
  if (task === undefined) throw new Error("Started Task was not found");
  return {
    ok: true,
    changed,
    task,
    changeId: start.changeId,
    branchRef: start.branchRef,
    startingCommit: start.startingCommit,
    worktreePath: start.worktreePath,
  };
};
