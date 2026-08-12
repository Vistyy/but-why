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
    const requiredExecution = execution ?? review.toolingFailure?.pendingExecution;
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
        requiredExecution,
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
        requiredExecution,
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
        requiredExecution,
      );
    }

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
          requiredExecution,
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
        requiredExecution,
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
        requiredExecution,
      );
    }

    return { ok: true } as const;
  });

const settlementFailed = (
  persistence: TaskReviewEvidencePersistence,
  review: TaskReviewRecord,
  failure: TaskReviewToolingFailure,
  now: string,
  pendingExecution?: TaskReviewExecution,
): Effect.Effect<TaskReviewEvidenceSettlementResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const retainedFailure =
      pendingExecution === undefined || failure.pendingExecution !== undefined
        ? failure
        : { ...failure, pendingExecution };
    yield* persistence.recordActiveFailure(review.id, retainedFailure, now);
    const current = yield* persistence.getById(review.id);
    return {
      ok: false,
      review: current ?? { ...review, toolingFailure: retainedFailure, updatedAt: now },
      message: retainedFailure.message,
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
