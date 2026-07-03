import type { TaskState } from "./lifecycle.js";

export type TaskSummary = {
  readonly id: string;
  readonly title: string;
  readonly state: TaskState;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type TaskRecord = TaskSummary & {
  readonly description: string;
  readonly branch: string | null;
  readonly latestRun: string | null;
  readonly commentCount: number;
};

export type TaskContext = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly comments: readonly string[];
};
