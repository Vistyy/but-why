import type { Effect } from "effect";

import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type { TaskState } from "./lifecycle.js";
import type { PublicTaskId } from "./taskId.js";
import type {
  TaskReviewFinding,
  TaskReviewOutcome,
  TaskReviewPolicySnapshot,
  TaskReviewProposal,
  TaskReviewRecord,
  TaskReviewSessionRecord,
  TaskReviewToolingFailure,
  TaskReviewTranscript,
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
      readonly reused: true;
      readonly reviewId: string;
      readonly outcome: "passed" | "blocked";
    }
  | {
      readonly ok: true;
      readonly reused: false;
      readonly reviewId: string;
      readonly proposal: TaskReviewProposal;
    }
  | { readonly ok: false; readonly code: "task_not_found" }
  | { readonly ok: false; readonly code: "invalid_task_state"; readonly state: TaskState }
  | { readonly ok: false; readonly code: "task_linked_to_change" }
  | { readonly ok: false; readonly code: "review_active"; readonly reviewId: string };

export type CheckTaskReviewReuseResult =
  | { readonly reused: true; readonly reviewId: string; readonly outcome: "passed" | "blocked" }
  | { readonly reused: false };

export type ApplyTaskReviewReuseResult =
  | { readonly ok: true; readonly task: TaskReviewTaskFact }
  | {
      readonly ok: false;
      readonly code: "review_not_found" | "task_not_found" | "task_state_changed";
    };

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
      readonly code: "review_not_found" | "review_not_active" | "task_state_changed";
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
  readonly startOrReuse: (input: StartTaskReviewInput) => StorageEffect<StartTaskReviewResult>;
  readonly checkReuse: (taskId: PublicTaskId) => StorageEffect<CheckTaskReviewReuseResult>;
  readonly applyReuse: (input: {
    readonly reviewId: string;
    readonly outcome: "passed" | "blocked";
    readonly now: string;
  }) => StorageEffect<ApplyTaskReviewReuseResult>;
  readonly getTaskFact: (taskId: PublicTaskId) => StorageEffect<TaskReviewTaskFact | undefined>;
  readonly complete: (input: CompleteTaskReviewInput) => StorageEffect<CompleteTaskReviewResult>;
  readonly getActiveForTask: (taskId: PublicTaskId) => StorageEffect<ActiveTaskReview | undefined>;
  readonly getActiveByReviewId: (reviewId: string) => StorageEffect<ActiveTaskReview | undefined>;
  readonly getAbandonmentContext: (
    reviewId: string,
  ) => StorageEffect<TaskReviewAbandonmentContext | undefined>;
  readonly getReviewById: (reviewId: string) => StorageEffect<TaskReviewRecord | undefined>;
  readonly listReviewsForTask: (taskId: PublicTaskId) => StorageEffect<readonly TaskReviewRecord[]>;
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
  readonly abandon: (input: AbandonTaskReviewInput) => StorageEffect<AbandonTaskReviewResult>;
  readonly getTaskReviewSession: (
    taskId: PublicTaskId,
    producer: string,
  ) => StorageEffect<TaskReviewSessionRecord | undefined>;
  readonly saveTaskReviewSession: (input: TaskReviewSessionRecord) => StorageEffect<void>;
  readonly removeTaskReviewSession: (taskId: PublicTaskId, producer: string) => StorageEffect<void>;
  readonly listTaskReviewTranscripts: (
    taskId: PublicTaskId,
  ) => StorageEffect<readonly TaskReviewTranscript[]>;
  readonly recordTaskReviewTranscripts: (input: {
    readonly taskId: PublicTaskId;
    readonly transcripts: readonly TaskReviewTranscript[];
  }) => StorageEffect<void>;
};

export type TaskReviewAbandonmentContext = {
  readonly reviewId: string;
  readonly taskId: PublicTaskId;
  readonly submittedSha: string;
  readonly tempRefName?: string;
  readonly worktreePath?: string;
  readonly cleanupWorktree: "removed" | "not_created" | "failed" | null;
  readonly cleanupTempRef: "removed" | "not_created" | "failed" | null;
};

export type AbandonTaskReviewResult =
  | { readonly ok: true; readonly status: "abandoned" | "already_complete" }
  | {
      readonly ok: false;
      readonly status: "not_found" | "cleanup_failed";
      readonly reviewId: string;
      readonly taskId?: PublicTaskId;
      readonly cleanup: { readonly worktree: string; readonly tempRef: string };
    };
