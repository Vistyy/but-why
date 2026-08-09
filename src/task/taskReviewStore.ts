import type { Effect } from "effect";

import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type { TaskState } from "./lifecycle.js";
import type { PublicTaskId } from "./taskId.js";
import type {
  TaskReviewAbandonmentContext,
  TaskReviewFinding,
  TaskReviewOutcome,
  TaskReviewPolicySnapshot,
  TaskReviewProposal,
  TaskReviewRecord,
  TaskReviewToolingFailure,
  TaskReviewWorkspaceSetup,
} from "./taskReview.js";

type StorageEffect<A> = Effect.Effect<A, RepositoryStorageError>;

export type StartTaskReviewInput = {
  readonly taskId: PublicTaskId;
  readonly baseCommit: string;
  readonly policy: TaskReviewPolicySnapshot;
  readonly reviewId?: string;
  readonly workspaceSetup?: {
    readonly tempRefName: string;
    readonly worktreePath: string;
  };
  readonly now: string;
};

export type StartTaskReviewResult =
  | {
      readonly ok: true;
      readonly reviewId: string;
      readonly proposal: TaskReviewProposal;
    }
  | { readonly ok: false; readonly code: "task_not_found" }
  | { readonly ok: false; readonly code: "invalid_task_state"; readonly state: TaskState }
  | { readonly ok: false; readonly code: "task_linked_to_change" }
  | { readonly ok: false; readonly code: "review_active"; readonly reviewId: string };

export type CompleteTaskReviewInput = {
  readonly reviewId: string;
  readonly outcome: TaskReviewOutcome;
  readonly findings?: readonly Omit<TaskReviewFinding, "createdAt">[];
  readonly now: string;
};

export type CompleteTaskReviewResult =
  | { readonly ok: true; readonly review: TaskReviewRecord; readonly task: TaskReviewTaskFact }
  | {
      readonly ok: false;
      readonly code:
        | "review_not_found"
        | "review_not_active"
        | "task_state_changed"
        | "passed_with_findings";
    };

export type TaskReviewTaskFact = {
  readonly id: PublicTaskId;
  readonly state: TaskState;
};

export type RecordTaskReviewToolingFailureInput = {
  readonly reviewId: string;
  readonly errorKind: string;
  readonly operationName: string;
  readonly errorMessage: string;
  readonly now: string;
};

export type RecordTaskReviewCompletionFailureInput = {
  readonly reviewId: string;
  readonly operationName: string;
  readonly errorMessage: string;
  readonly now: string;
};

export type TaskReviewCompletionFailure = {
  readonly reviewId: string;
  readonly operationName: string;
  readonly errorMessage: string;
  readonly createdAt: string;
};

export type AbandonTaskReviewInput = {
  readonly reviewId: string;
  readonly errorKind: string;
  readonly operationName: string;
  readonly errorMessage: string;
  readonly now: string;
};

export type ActiveTaskReview = {
  readonly reviewId: string;
  readonly taskId: PublicTaskId;
};

export type TaskReviewPersistence = {
  readonly start: (input: StartTaskReviewInput) => StorageEffect<StartTaskReviewResult>;
  readonly getTaskFact: (taskId: PublicTaskId) => StorageEffect<TaskReviewTaskFact | undefined>;
  readonly complete: (input: CompleteTaskReviewInput) => StorageEffect<CompleteTaskReviewResult>;
  readonly getActiveForTask: (taskId: PublicTaskId) => StorageEffect<ActiveTaskReview | undefined>;
  readonly getActiveByReviewId: (reviewId: string) => StorageEffect<ActiveTaskReview | undefined>;
  readonly getAbandonmentContext: (
    reviewId: string,
  ) => StorageEffect<TaskReviewAbandonmentContext | undefined>;
  readonly listFindings: (reviewId: string) => StorageEffect<readonly TaskReviewFinding[]>;
  readonly listToolingFailures: (
    reviewId: string,
  ) => StorageEffect<readonly TaskReviewToolingFailure[]>;
  readonly latestCompletedReviewForTask: (
    taskId: PublicTaskId,
  ) => StorageEffect<TaskReviewRecord | undefined>;
  readonly recordWorkspaceSetup: (input: TaskReviewWorkspaceSetup) => StorageEffect<void>;
  readonly recordToolingFailure: (
    input: RecordTaskReviewToolingFailureInput,
  ) => StorageEffect<void>;
  readonly recordCompletionFailure: (
    input: RecordTaskReviewCompletionFailureInput,
  ) => StorageEffect<void>;
  readonly getCompletionFailure: (
    reviewId: string,
  ) => StorageEffect<TaskReviewCompletionFailure | undefined>;
  readonly abandon: (
    input: AbandonTaskReviewInput,
  ) => StorageEffect<AbandonTaskReviewPersistenceResult>;
};

export type AbandonTaskReviewPersistenceResult =
  | { readonly ok: true; readonly status: "abandoned" | "already_complete" }
  | {
      readonly ok: false;
      readonly status: "not_found" | "cleanup_failed";
      readonly reviewId: string;
      readonly taskId?: PublicTaskId;
      readonly cleanup: { readonly worktree: string; readonly tempRef: string };
    };
