import type { TaskState } from "./lifecycle.js";
import type { DependencyValidationCode, TaskRecord, TaskSummary } from "./task.js";
import type { PublicTaskId } from "./taskId.js";
import type { TaskTitleValidationCode } from "./taskTitle.js";

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

export type RenameTaskInput = {
  readonly taskId: PublicTaskId;
  readonly title: string;
};

export type RenameTaskResult =
  | { readonly ok: true; readonly noOp: boolean; readonly task: TaskRecord }
  | { readonly ok: false; readonly code: TaskTitleValidationCode }
  | { readonly ok: false; readonly code: "task_not_found" }
  | { readonly ok: false; readonly code: "task_change_linked"; readonly changeId: string }
  | { readonly ok: false; readonly code: "task_revision_required"; readonly state: "todo" }
  | {
      readonly ok: false;
      readonly code: "invalid_task_state";
      readonly state: "done" | "cancelled";
    };

export type EditTaskDependenciesResult =
  | {
      readonly ok: true;
      readonly operation: TaskDependencyOperation;
      readonly task: TaskRecord;
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

export type UpdateTaskContextInput = {
  readonly taskId: PublicTaskId;
  readonly description: string;
  readonly now: string;
};

export type ReviseTaskInput = {
  readonly taskId: PublicTaskId;
  readonly now: string;
};

export type ReviseTaskResult =
  | { readonly ok: true; readonly changed: boolean; readonly task: TaskRecord }
  | { readonly ok: false; readonly code: "task_not_found" }
  | { readonly ok: false; readonly code: "task_change_linked"; readonly changeId: string }
  | { readonly ok: false; readonly code: "active_task_review"; readonly reviewId: number }
  | { readonly ok: false; readonly code: "invalid_task_state"; readonly state: TaskState };

export type CancelTaskInput = {
  readonly taskId: PublicTaskId;
  readonly reason: string;
  readonly now: string;
};

export type CancelTaskResult =
  | { readonly ok: true; readonly changed: boolean; readonly task: TaskRecord }
  | { readonly ok: false; readonly code: "task_not_found" }
  | { readonly ok: false; readonly code: "task_already_done" };
