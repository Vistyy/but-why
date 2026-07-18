import type { RepoPrepareConfig } from "../contracts/repoConfig.js";
import type { PublicTaskId } from "../task/taskId.js";
import type { TaskContextSnapshotV1 } from "../validationRun/taskContextSnapshot.js";

export type ChangeState = "open" | "closed";
export type ChangeCloseReason = "completed" | "cancelled";
export type ChangeReadiness = "pending" | "ready" | "prepare_failed";

export type ChangePrepareFailure = {
  readonly command: string;
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
};

export type ChangeRecord = {
  readonly id: string;
  readonly repositoryCommonDirectory: string;
  readonly branchRef: string;
  readonly baseRef: string | null;
  readonly taskId: PublicTaskId | null;
  readonly startingCommit: string | null;
  readonly worktreePath: string | null;
  readonly acceptanceContext: TaskContextSnapshotV1 | null;
  readonly readiness: ChangeReadiness | null;
  readonly prepare: (RepoPrepareConfig & { readonly timeoutSeconds: number }) | null;
  readonly prepareFailure: ChangePrepareFailure | null;
  readonly state: ChangeState;
  readonly closeReason: ChangeCloseReason | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt: string | null;
};
