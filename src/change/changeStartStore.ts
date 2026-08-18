import type { AgentEnvironmentCommand } from "../agent/agentEnvironment.js";
import type { AcceptanceReviewPolicy } from "./acceptanceReview/acceptanceReviewConfig.js";
import type { ChangePrepareDefinition, ChangePrepareFailure, ChangeState } from "./change.js";
import type { SpecialistReviewPolicy } from "./specialistReview/specialistReviewConfig.js";
import type { SubmitCheckConfig } from "./submit/submitRepoConfig.js";
import type { AcceptanceContextSnapshotV1 } from "./validationRun/acceptanceContextSnapshot.js";

export type ChangeReviewerConfiguration = {
  readonly acceptanceReview: AcceptanceReviewPolicy | null;
  readonly specialistReviews: readonly SpecialistReviewPolicy[];
  readonly agentEnvironment?: AgentEnvironmentCommand;
};

export type ChangePolicy = {
  readonly reviewerConfiguration: ChangeReviewerConfiguration;
  readonly prepare: ChangePrepareDefinition | null;
  readonly checks: readonly SubmitCheckConfig[];
};

export type ChangeStartRecord = {
  readonly id: string;
  readonly repositoryCommonDirectory: string;
  readonly branchRef: string;
  readonly baseRef: string;
  readonly baseRemoteUrl: string;
  readonly worktreePath: string;
  readonly acceptanceContext: AcceptanceContextSnapshotV1 | null;
  readonly reviewerConfiguration: ChangeReviewerConfiguration;
  readonly prepare: ChangePrepareDefinition | null;
  readonly checks: readonly SubmitCheckConfig[];
  readonly prepareFailure: ChangePrepareFailure | null;
  readonly state: ChangeState;
};

export type CreateChangeStartInput = {
  readonly id: string;
  readonly repositoryCommonDirectory: string;
  readonly branchRef: string;
  readonly baseRef: string;
  readonly baseRemoteUrl: string;
  readonly startingCommit: string;
  readonly worktreePath: string;
  readonly reviewerConfiguration: ChangeReviewerConfiguration;
  readonly prepare?: { readonly command: string; readonly timeoutSeconds: number };
  readonly checks: readonly SubmitCheckConfig[];
  readonly now: string;
};
