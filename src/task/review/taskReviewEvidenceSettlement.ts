import { Effect } from "effect";
import { reviewerSessionsOwnerRoot } from "../../agent/reviewerSession/reviewerSession.js";
import { discoverObservedReviewerTranscripts } from "../../agent/reviewerSession/reviewerTranscript.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type {
  ExactDisposableWorkspaceCleanupInput,
  ExactDisposableWorkspaceCleanupResult,
} from "../../disposableWorkspace/disposableWorkspace.js";
import type {
  TaskReviewExecution,
  TaskReviewRecord,
  TaskReviewToolingFailure,
} from "./taskReview.js";
import type { TaskReviewPersistence } from "./taskReviewPersistence.js";

type TaskReviewEvidencePersistence = Pick<
  TaskReviewPersistence,
  "recordCleanup" | "recordExecution" | "recordTranscripts" | "recordActiveFailure" | "getById"
>;

export type TaskReviewEvidenceSettlementResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly review: TaskReviewRecord;
      readonly message: string;
    };

export const settleTaskReviewEvidence = (
  input: {
    readonly mainCheckoutRoot: string;
    readonly reviewerSessionStorageRoot: string;
    readonly persistence: TaskReviewEvidencePersistence;
    readonly verifyReviewBase: (
      mainCheckoutRoot: string,
      recorded: { readonly ref: string; readonly commit: string },
    ) => Effect.Effect<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
    readonly cleanupWorkspace: (
      mainCheckoutRoot: string,
      cleanup: ExactDisposableWorkspaceCleanupInput,
    ) => Effect.Effect<ExactDisposableWorkspaceCleanupResult>;
  },
  review: TaskReviewRecord,
  now: string,
  execution?: TaskReviewExecution,
): Effect.Effect<TaskReviewEvidenceSettlementResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const base = yield* input.verifyReviewBase(input.mainCheckoutRoot, {
      ref: review.baseRef,
      commit: review.baseCommit,
    });
    if (!base.ok) {
      return yield* settlementFailed(
        input.persistence,
        review,
        {
          operation: "verify_task_review_base",
          message: base.message,
        },
        now,
      );
    }

    const cleanup = yield* input.cleanupWorkspace(input.mainCheckoutRoot, {
      workspaceId: review.id,
      expectedCommitSha: review.baseCommit,
      recordedWorktreePath: review.workspacePath,
    });
    const cleanupRecorded = yield* Effect.either(
      input.persistence.recordCleanup(review.id, cleanup.workspace, now),
    );
    if (cleanupRecorded._tag === "Left") {
      return yield* settlementFailed(
        input.persistence,
        review,
        {
          operation: "record_task_review_cleanup",
          message: repositoryStorageErrorMessage(
            "Task Review workspace cleanup",
            cleanupRecorded.left,
          ),
        },
        now,
      );
    }
    if (cleanup.workspace !== "removed") {
      return yield* settlementFailed(
        input.persistence,
        review,
        {
          operation: "cleanup_task_review_workspace",
          message: cleanup.errorMessage ?? "Task Review workspace cleanup failed.",
        },
        now,
      );
    }

    const requiredExecution = execution ?? review.toolingFailure?.pendingExecution;
    if (requiredExecution !== undefined) {
      const recordedExecution = yield* Effect.either(
        recordTaskReviewExecutionWithRetry(input.persistence.recordExecution, {
          reviewId: review.id,
          execution: requiredExecution,
        }),
      );
      if (recordedExecution._tag === "Left") {
        return yield* settlementFailed(
          input.persistence,
          review,
          {
            operation: "record_task_review_execution",
            message: repositoryStorageErrorMessage("Task Review execution", recordedExecution.left),
            pendingExecution: requiredExecution,
          },
          now,
        );
      }
    }

    const transcriptDiscovery = discoverObservedReviewerTranscripts(
      reviewerSessionsOwnerRoot(input.reviewerSessionStorageRoot, review.taskId),
      review.taskId,
    );
    if (!transcriptDiscovery.ok) {
      return yield* settlementFailed(
        input.persistence,
        review,
        {
          operation: "index_task_reviewer_transcripts",
          message: transcriptDiscovery.reason,
        },
        now,
      );
    }
    const indexed = yield* Effect.either(
      input.persistence.recordTranscripts({
        reviewId: review.id,
        taskId: review.taskId,
        transcripts: transcriptDiscovery.transcripts,
      }),
    );
    if (indexed._tag === "Left") {
      return yield* settlementFailed(
        input.persistence,
        review,
        {
          operation: "index_task_reviewer_transcripts",
          message: repositoryStorageErrorMessage("Task Reviewer Transcript", indexed.left),
        },
        now,
      );
    }

    return { ok: true } as const;
  });

const settlementFailed = (
  persistence: TaskReviewEvidencePersistence,
  review: TaskReviewRecord,
  failure: TaskReviewToolingFailure,
  now: string,
): Effect.Effect<TaskReviewEvidenceSettlementResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    yield* persistence.recordActiveFailure(review.id, failure, now);
    const current = yield* persistence.getById(review.id);
    return {
      ok: false,
      review: current ?? { ...review, toolingFailure: failure, updatedAt: now },
      message: failure.message,
    } as const;
  });

export const recordTaskReviewExecutionWithRetry = (
  recordExecution: TaskReviewPersistence["recordExecution"],
  input: Parameters<TaskReviewPersistence["recordExecution"]>[0],
): Effect.Effect<void, RepositoryStorageError> =>
  recordExecution(input).pipe(
    Effect.catchTag("RepositorySqlOperationFailed", () => recordExecution(input)),
  );

const repositoryStorageErrorMessage = (subject: string, error: RepositoryStorageError): string =>
  "operationName" in error
    ? `${subject} persistence failed during ${error.operationName}.`
    : `${subject} persistence failed: ${error._tag}.`;
