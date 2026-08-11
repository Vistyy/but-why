import type { Effect } from "effect";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { ReviewerFindingCore } from "../../contracts/reviewerFinding.js";
import type { DisposableWorkspaceCleanupState } from "../../disposableWorkspace/disposableWorkspace.js";
import type { PublicTaskId } from "../taskId.js";
import type {
  TaskReviewDependencyEvidence,
  TaskReviewPolicySnapshot,
  TaskReviewProposal,
  TaskReviewRecord,
  TaskReviewToolingFailure,
} from "./taskReview.js";

export type AdmitTaskReviewInput = {
  readonly reviewId: string;
  readonly taskId: PublicTaskId;
  readonly policy: TaskReviewPolicySnapshot;
  readonly baseRef: string;
  readonly baseCommit: string;
  readonly workspacePath: string;
  readonly now: string;
};

export type AdmitTaskReviewResult =
  | {
      readonly ok: true;
      readonly review: TaskReviewRecord;
      readonly proposal: TaskReviewProposal;
      readonly dependencyEvidence: readonly TaskReviewDependencyEvidence[];
    }
  | { readonly ok: false; readonly code: "task_not_found" }
  | { readonly ok: false; readonly code: "invalid_task_state"; readonly state: string }
  | { readonly ok: false; readonly code: "active_task_review"; readonly reviewId: string };

export type CompleteTaskReviewInput = {
  readonly reviewId: string;
  readonly findings: readonly ReviewerFindingCore[];
  readonly toolingFailure?: TaskReviewToolingFailure;
  readonly now: string;
};

export type CompleteTaskReviewResult =
  | { readonly ok: true; readonly review: TaskReviewRecord }
  | { readonly ok: false; readonly code: "task_review_not_found" | "task_review_not_active" };

export type TaskReviewPersistence = {
  readonly admit: (
    input: AdmitTaskReviewInput,
  ) => Effect.Effect<AdmitTaskReviewResult, RepositoryStorageError>;
  readonly recordCleanup: (
    reviewId: string,
    cleanup: DisposableWorkspaceCleanupState,
    now: string,
  ) => Effect.Effect<void, RepositoryStorageError>;
  readonly complete: (
    input: CompleteTaskReviewInput,
  ) => Effect.Effect<CompleteTaskReviewResult, RepositoryStorageError>;
  readonly abandon: (
    reviewId: string,
    reason: string,
    now: string,
  ) => Effect.Effect<CompleteTaskReviewResult, RepositoryStorageError>;
  readonly getById: (
    reviewId: string,
  ) => Effect.Effect<TaskReviewRecord | undefined, RepositoryStorageError>;
  readonly getLatestForTask: (
    taskId: PublicTaskId,
  ) => Effect.Effect<TaskReviewRecord | undefined, RepositoryStorageError>;
  readonly proposalIsCurrent: (
    review: TaskReviewRecord,
  ) => Effect.Effect<boolean, RepositoryStorageError>;
};
