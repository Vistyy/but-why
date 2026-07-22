import type { ChangeReadiness, ChangeRecord } from "./change.js";
import type { TaskDependencyFact } from "../task/task.js";
import type { PublicTaskId } from "../task/taskId.js";
import type { TaskState } from "../task/lifecycle.js";

export type ChangeStartRecord = ChangeRecord & {
  readonly baseRef: string;
  readonly startingCommit: string;
  readonly worktreePath: string;
  readonly readiness: ChangeReadiness;
};

export type CreateChangeStartInput = {
  readonly id: string;
  readonly repositoryCommonDirectory: string;
  readonly branchRef: string;
  readonly baseRef: string;
  readonly startingCommit: string;
  readonly worktreePath: string;
  readonly taskId?: PublicTaskId;
  readonly prepare?: { readonly command: string; readonly timeoutSeconds: number };
  readonly now: string;
};

export type ChangeStartEligibilityError =
  | { readonly ok: false; readonly code: "task_not_found" }
  | { readonly ok: false; readonly code: "invalid_task_state"; readonly state: TaskState }
  | {
      readonly ok: false;
      readonly code: "task_dependencies_unsatisfied";
      readonly blockedBy: readonly TaskDependencyFact[];
    };
