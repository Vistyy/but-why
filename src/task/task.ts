import type { TaskState } from "./lifecycle.js";
import type { PublicTaskId } from "./taskId.js";

export type TaskDependencyFact = {
  readonly id: string;
  readonly title: string;
  readonly state: TaskState;
};

export type TaskSummary = {
  readonly id: string;
  readonly title: string;
  readonly state: TaskState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startable: boolean;
  readonly blockedBy: readonly TaskDependencyFact[];
};

export type TaskRecord = TaskSummary & {
  readonly description: string;
  readonly commentCount: number;
  readonly prerequisites: readonly TaskDependencyFact[];
  readonly dependents: readonly TaskDependencyFact[];
};

export type DependencyValidationCode =
  | "dependency_unknown_task"
  | "dependency_self"
  | "dependency_duplicate"
  | "dependency_cycle";

export class TaskDependencyValidationError extends Error {
  constructor(
    readonly code: DependencyValidationCode,
    readonly taskId?: PublicTaskId,
  ) {
    super(code);
  }
}

export type TaskContext = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly comments: readonly string[];
};
