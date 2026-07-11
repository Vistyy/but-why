import type { PublicTaskId } from "../task/taskId.js";

export type ChangeState = "open" | "closed";
export type ChangeCloseReason = "completed" | "cancelled";

export type ChangeRecord = {
  readonly id: string;
  readonly repositoryCommonDirectory: string;
  readonly branchRef: string;
  readonly taskId: PublicTaskId | null;
  readonly state: ChangeState;
  readonly closeReason: ChangeCloseReason | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt: string | null;
};
