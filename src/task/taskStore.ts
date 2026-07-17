import type { TaskState } from "./lifecycle.js";
import type { TaskContext, TaskRecord, TaskSummary } from "./task.js";
import type { PublicTaskId } from "./taskId.js";

export type TaskStore = {
  readonly createTask: (input: CreateTaskInput) => TaskSummary;
  readonly listTasks: (input: ListTasksInput) => readonly TaskSummary[];
  readonly listActionableTasks: () => readonly TaskSummary[];
  readonly getTaskById: (taskId: PublicTaskId) => StoredTaskRecord | undefined;
  readonly getTaskContextById: (taskId: PublicTaskId) => TaskContext | undefined;
  readonly appendTaskComment: (
    input: AppendTaskCommentInput,
  ) => AppendTaskCommentResult | undefined;
  readonly updateTaskContext: (input: UpdateTaskContextInput) => UpdateTaskContextResult;
  readonly transitionTaskState: (input: TransitionTaskStateInput) => TaskStateTransitionResult;
};

export type StoredTaskRecord = Omit<TaskRecord, "latestValidationRun">;

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

export type AppendTaskCommentResult = {
  readonly taskId: PublicTaskId;
  readonly commentCount: number;
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
    };
