import type { TaskContext } from "../task/task.js";

export type TaskContextSnapshotState = "not_required" | "pending" | "saved" | "failed";

export type TaskContextSnapshotOperationName =
  | "read_task_context"
  | "build_task_context_snapshot"
  | "save_task_context_snapshot"
  | "recover_pending_task_context_snapshot";

export type TaskContextSnapshotV1 = {
  readonly version: 1;
  readonly title: string;
  readonly description: string;
  readonly comments: readonly string[];
};

export const taskContextSnapshotV1 = (context: TaskContext): TaskContextSnapshotV1 => ({
  version: 1,
  title: context.title,
  description: context.description,
  comments: [...context.comments],
});
