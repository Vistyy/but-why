import type { TaskContextSnapshotV1 } from "../validationRun/taskContextSnapshot.js";
import type { PublicTaskId } from "../task/taskId.js";

export type TaskStartProvisioningState = "pending" | "ready";

export type TaskStartRecord = {
  readonly taskId: PublicTaskId;
  readonly changeId: string;
  readonly branchRef: string;
  readonly baseRef: string;
  readonly startingCommit: string;
  readonly worktreePath: string;
  readonly acceptanceContext: TaskContextSnapshotV1;
  readonly provisioningState: TaskStartProvisioningState;
  readonly createdAt: string;
  readonly updatedAt: string;
};
