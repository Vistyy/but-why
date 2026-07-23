import type { TaskState } from "./lifecycle.js";
import type { DependencyValidationCode, TaskDependencyFact, TaskRecord } from "./task.js";
import type { PublicTaskId } from "./taskId.js";

export type StoredTaskRecord = TaskRecord;

export type CreateTaskInput = {
  readonly title: string;
  readonly description: string;
  readonly now: string;
  readonly dependsOn?: readonly PublicTaskId[];
};

export type ReplaceTaskDependenciesInput = {
  readonly taskId: PublicTaskId;
  readonly prerequisiteTaskIds: readonly PublicTaskId[];
};

export type ReplaceTaskDependenciesResult =
  | { readonly ok: true; readonly task: StoredTaskRecord }
  | { readonly ok: false; readonly code: "task_not_found" }
  | { readonly ok: false; readonly code: DependencyValidationCode; readonly taskId?: PublicTaskId }
  | { readonly ok: false; readonly code: "dependencies_locked"; readonly state: TaskState };

export type ListTasksInput = {
  readonly includeDone: boolean;
  readonly state?: TaskState;
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

export type TransitionTaskStateInput = {
  readonly taskId: PublicTaskId;
  readonly to: TaskState;
  readonly now: string;
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

export type TaskStateTransitionResult =
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
      readonly code: "invalid_task_state_transition";
      readonly from: TaskState;
      readonly to: TaskState;
    }
  | {
      readonly ok: false;
      readonly code: "task_dependencies_unsatisfied";
      readonly blockedBy: readonly TaskDependencyFact[];
    };
