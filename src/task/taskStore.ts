import type { TaskState } from "./lifecycle.js";
import type { TaskContext } from "./task.js";
import type { DependencyValidationCode, TaskRecord, TaskSummary } from "./task.js";
import type { PublicTaskId } from "./taskId.js";

export type StoredTaskRecord = TaskRecord;

export type CreateTaskInput = {
  readonly title: string;
  readonly description: string;
  readonly now: string;
  readonly dependsOn?: readonly PublicTaskId[];
};

export type TaskDependencyOperation = "add" | "remove" | "replace" | "clear";

export type EditTaskDependenciesInput = {
  readonly taskId: PublicTaskId;
  readonly operation: TaskDependencyOperation;
  readonly prerequisiteTaskIds: readonly PublicTaskId[];
};

export type EditTaskDependenciesResult =
  | {
      readonly ok: true;
      readonly operation: TaskDependencyOperation;
      readonly task: StoredTaskRecord;
      readonly added: readonly PublicTaskId[];
      readonly removed: readonly PublicTaskId[];
      readonly unchanged: readonly PublicTaskId[];
    }
  | { readonly ok: false; readonly code: "task_not_found" }
  | {
      readonly ok: false;
      readonly code: DependencyValidationCode | "replace_requires_dependency";
      readonly taskId?: PublicTaskId;
    }
  | { readonly ok: false; readonly code: "dependencies_locked"; readonly state: TaskState };

export type TaskListLimit = number | "all";

export type ListTasksInput = {
  readonly includeDone: boolean;
  readonly state?: TaskState;
  readonly limit?: TaskListLimit;
};

export type ListTasksResult = {
  readonly tasks: readonly TaskSummary[];
  readonly total: number;
};

export type ApproveTaskInput = {
  readonly taskId: PublicTaskId;
  readonly now: string;
};

export type TaskApprovalResult =
  | {
      readonly ok: true;
      readonly changed: boolean;
      readonly task: StoredTaskRecord;
    }
  | {
      readonly ok: false;
      readonly code: "task_not_found";
    }
  | {
      readonly ok: false;
      readonly code: "invalid_task_state";
      readonly state: TaskState;
    };

export type AppendTaskCommentInput = {
  readonly taskId: PublicTaskId;
  readonly content: string;
  readonly now: () => string;
};

export type AppendTaskCommentResult =
  | {
      readonly ok: true;
      readonly taskId: PublicTaskId;
      readonly commentCount: number;
      readonly state: TaskState;
      readonly updatedAt: string;
      readonly content: string;
    }
  | {
      readonly ok: false;
      readonly code: "task_not_found";
    }
  | {
      readonly ok: false;
      readonly code: "invalid_task_state";
      readonly state: TaskState;
    };

export type UpdateTaskContextInput = {
  readonly taskId: PublicTaskId;
  readonly title: string;
  readonly description: string;
  readonly now: string;
};

export type UpdateTaskContextResult =
  | {
      readonly ok: true;
      readonly task: StoredTaskRecord;
      readonly context: TaskContext;
    }
  | {
      readonly ok: false;
      readonly code: "task_not_found";
    }
  | {
      readonly ok: false;
      readonly code: "invalid_task_state";
      readonly state: TaskState;
    };

export type CancelTaskInput = {
  readonly taskId: PublicTaskId;
  readonly reason: string;
  readonly now: string;
};

export type CancelTaskResult =
  | { readonly ok: true; readonly changed: boolean; readonly task: StoredTaskRecord }
  | { readonly ok: false; readonly code: "task_not_found" }
  | { readonly ok: false; readonly code: "task_already_done" };
