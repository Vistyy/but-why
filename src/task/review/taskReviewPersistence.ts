import type { Effect } from "effect";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { DisposableWorkspaceCleanupState } from "../../disposableWorkspace/disposableWorkspace.js";
import type { PublicTaskId } from "../taskId.js";
import type {
  TaskReviewDependencyEvidence,
  TaskReviewFinding,
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
  readonly findings: readonly TaskReviewFinding[];
  readonly toolingFailure?: TaskReviewToolingFailure;
  readonly now: string;
};

type CompletedTaskReviewRecord = Omit<TaskReviewRecord, "state" | "outcome"> & {
  readonly state: "complete";
};

type PassedTaskReviewRecord = CompletedTaskReviewRecord & {
  readonly outcome: "passed";
  readonly findings: readonly [];
  readonly toolingFailure: null;
};

type BlockedTaskReviewRecord = CompletedTaskReviewRecord & {
  readonly outcome: "blocked";
  readonly findings: readonly [TaskReviewFinding, ...TaskReviewFinding[]];
  readonly toolingFailure: null;
};

type ToolingFailedTaskReviewRecord = CompletedTaskReviewRecord & {
  readonly outcome: "tooling_failed";
  readonly toolingFailure: TaskReviewToolingFailure;
};

export type CompleteTaskReviewSuccess =
  | {
      readonly ok: true;
      readonly outcome: "passed";
      readonly review: PassedTaskReviewRecord;
      readonly task: { readonly id: string; readonly state: "todo" };
    }
  | {
      readonly ok: true;
      readonly outcome: "blocked";
      readonly review: BlockedTaskReviewRecord;
    }
  | {
      readonly ok: true;
      readonly outcome: "tooling_failed";
      readonly review: ToolingFailedTaskReviewRecord;
    };

export type CompleteTaskReviewResult =
  | CompleteTaskReviewSuccess
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
