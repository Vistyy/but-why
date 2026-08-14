import type { TaskState } from "../task/lifecycle.js";
import type { TaskDependencyFact } from "../task/task.js";
import type { PublicTaskId } from "../task/taskId.js";
import type { AcceptanceReviewPolicy } from "./acceptanceReview/acceptanceReviewConfig.js";
import type { ChangePrepareDefinition, ChangePrepareFailure, ChangeState } from "./change.js";
import type { SpecialistReviewPolicy } from "./specialistReview/specialistReviewConfig.js";
import type { AcceptanceContextSnapshotV1 } from "./validationRun/acceptanceContextSnapshot.js";

export type ChangeReviewerConfiguration = {
  readonly acceptanceReview: AcceptanceReviewPolicy | null;
  readonly specialistReviews: readonly SpecialistReviewPolicy[];
};

export type ChangeStartRecord = {
  readonly id: string;
  readonly repositoryCommonDirectory: string;
  readonly branchRef: string;
  readonly baseRef: string;
  readonly baseRemoteUrl: string;
  readonly taskId: PublicTaskId | null;
  readonly startingCommit: string;
  readonly worktreePath: string;
  readonly acceptanceContext: AcceptanceContextSnapshotV1 | null;
  readonly reviewerConfiguration?: ChangeReviewerConfiguration | null;
  readonly prepare: ChangePrepareDefinition | null;
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
  readonly taskId?: PublicTaskId;
  readonly reviewerConfiguration?: ChangeReviewerConfiguration;
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
