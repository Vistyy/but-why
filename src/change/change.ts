import type { PublicTaskId } from "../task/taskId.js";
import type { TaskContextSnapshotV1 } from "../validationRun/taskContextSnapshot.js";

export const changeState = {
  open: "open",
  closed: "closed",
} as const;

const changeCloseReason = {
  completed: "completed",
  cancelled: "cancelled",
} as const;

export const changeReadiness = {
  pending: "pending",
  ready: "ready",
  prepareFailed: "prepare_failed",
} as const;

export type ChangeState = (typeof changeState)[keyof typeof changeState];
export type ChangeCloseReason = (typeof changeCloseReason)[keyof typeof changeCloseReason];
export type ChangeReadiness = (typeof changeReadiness)[keyof typeof changeReadiness];

export type ChangePrepareDefinition = {
  readonly command: string;
  readonly timeoutSeconds: number;
};

export type ChangePrepareFailure = {
  readonly command: string;
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
};

export type ChangePublicationTarget = {
  readonly owner: string;
  readonly repo: string;
  readonly baseBranch: string;
  readonly remoteName: string;
};

export type ChangeOwnedPullRequest = {
  readonly number: number;
  readonly url: string;
};

export type ChangeCleanup = {
  readonly state: "complete" | "pending";
  readonly blockingReason: string | null;
};

export type ChangePublication = {
  readonly candidateId: string;
  readonly validationRunId: string;
  readonly target: ChangePublicationTarget;
  readonly headBranch: string;
  readonly expectedHeadSha: string;
  readonly pullRequest: ChangeOwnedPullRequest | null;
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
  readonly prepare: ChangePrepareDefinition | null;
  readonly prepareFailure: ChangePrepareFailure | null;
  readonly publication: ChangePublication | null;
  readonly cleanup: ChangeCleanup;
  readonly state: ChangeState;
  readonly closeReason: ChangeCloseReason | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt: string | null;
};
