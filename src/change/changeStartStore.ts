import type { ChangePrepareFailure, ChangeState } from "./change.js";
import type { ChangePolicy } from "./changePolicy.js";
import type { AcceptanceContextSnapshotV1 } from "./validationRun/acceptanceContextSnapshot.js";

export type ChangeStartRecord = {
  readonly id: string;
  readonly repositoryCommonDirectory: string;
  readonly branchRef: string;
  readonly baseRef: string;
  readonly baseRemoteUrl: string;
  readonly worktreePath: string;
  readonly acceptanceContext: AcceptanceContextSnapshotV1 | null;
  readonly policy: ChangePolicy;
  readonly prepareFailure: ChangePrepareFailure | null;
  readonly state: ChangeState;
};

export type CreateChangeStartInput = {
  readonly baseRef: string;
  readonly baseRemoteUrl: string;
  readonly managedWorktreeParent: string;
  readonly policy: ChangePolicy;
};
