import type { TaskDependencyFact } from "../task/task.js";
import type { PublicTaskId } from "../task/taskId.js";
import type { TaskState } from "../task/lifecycle.js";
import type { TaskStartRecord } from "./taskStart.js";

export type BindTaskStartInput = {
  readonly taskId: PublicTaskId;
  readonly repositoryCommonDirectory: string;
  readonly branchRef: string;
  readonly baseRef: string;
  readonly startingCommit: string;
  readonly worktreePath: string;
  readonly now: string;
};

export type BindTaskStartResult =
  | { readonly ok: true; readonly changed: boolean; readonly start: TaskStartRecord }
  | { readonly ok: false; readonly code: "task_not_found" }
  | { readonly ok: false; readonly code: "invalid_task_state"; readonly state: TaskState }
  | {
      readonly ok: false;
      readonly code: "task_dependencies_unsatisfied";
      readonly blockedBy: readonly TaskDependencyFact[];
    }
  | { readonly ok: false; readonly code: "task_start_conflict" };

export type TaskStartStore = {
  readonly getByTaskId: (taskId: PublicTaskId) => TaskStartRecord | undefined;
  readonly bind: (input: BindTaskStartInput) => BindTaskStartResult;
  readonly markReady: (taskId: PublicTaskId, now: string) => TaskStartRecord;
};
