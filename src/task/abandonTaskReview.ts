import { Effect } from "effect";

import type { ExecutionLock } from "../contracts/executionLock.js";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import { deleteDisposableTempRef, removeDisposableWorktree } from "../workspace/workspaceGit.js";
import type { PublicTaskId } from "./taskId.js";
import type { TaskReviewPersistence } from "./taskReviewStore.js";
import { indexTaskReviewTranscripts } from "./taskReviewTranscripts.js";
import { taskReviewTempRefName } from "./taskReviewWorkspace.js";

export type AbandonTaskReview = {
  readonly abandon: (input: {
    readonly reviewId: string;
    readonly reason: string;
    readonly now: string;
  }) => Effect.Effect<AbandonTaskReviewResult, RepositoryStorageError>;
};

export type AbandonTaskReviewResult =
  | { readonly ok: true; readonly status: "abandoned" | "already_complete" }
  | {
      readonly ok: false;
      readonly status: "not_found" | "cleanup_failed" | "submission_in_progress";
      readonly reviewId: string;
      readonly taskId?: PublicTaskId;
      readonly cleanup: { readonly worktree: string; readonly tempRef: string };
    };

export const openAbandonTaskReview = (input: {
  readonly persistence: TaskReviewPersistence;
  readonly executionLock: ExecutionLock;
  readonly repoRoot: string;
  readonly reviewerSessionsRoot: string;
}): AbandonTaskReview => ({
  abandon: (command) =>
    Effect.gen(function* () {
      const context = yield* input.persistence.getAbandonmentContext(command.reviewId);
      if (context === undefined) {
        return {
          ok: false as const,
          status: "not_found" as const,
          reviewId: command.reviewId,
          cleanup: { worktree: "not_created", tempRef: "not_created" },
        };
      }
      return yield* input.executionLock
        .withLock({
          owner: "task_submission",
          key: context.taskId,
          effect: abandonWhileLocked(input, command),
        })
        .pipe(
          Effect.catchTag("ExecutionLockUnavailable", () =>
            input.persistence.getActiveByReviewId(command.reviewId).pipe(
              Effect.map((active) =>
                active === undefined
                  ? {
                      ok: true as const,
                      status: "already_complete" as const,
                    }
                  : {
                      ok: false as const,
                      status: "submission_in_progress" as const,
                      reviewId: command.reviewId,
                      cleanup: { worktree: "not_created", tempRef: "not_created" },
                    },
              ),
            ),
          ),
        );
    }),
});

const abandonWhileLocked = (
  input: {
    readonly persistence: TaskReviewPersistence;
    readonly repoRoot: string;
    readonly reviewerSessionsRoot: string;
  },
  command: { readonly reviewId: string; readonly reason: string; readonly now: string },
): Effect.Effect<AbandonTaskReviewResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const context = yield* input.persistence.getAbandonmentContext(command.reviewId);
    if (context === undefined) {
      return {
        ok: false as const,
        status: "not_found" as const,
        reviewId: command.reviewId,
        cleanup: { worktree: "not_created", tempRef: "not_created" },
      };
    }
    const active = yield* input.persistence.getActiveByReviewId(command.reviewId);
    if (active === undefined) {
      return { ok: true as const, status: "already_complete" as const };
    }

    const tempRefName = context.tempRefName ?? taskReviewTempRefName(command.reviewId);
    const tempRef =
      context.cleanupTempRef === "removed"
        ? "removed"
        : deleteDisposableTempRef(input.repoRoot, tempRefName);
    const worktreePath = context.worktreePath;
    const worktree =
      context.cleanupWorktree === "removed"
        ? "removed"
        : worktreePath === undefined
          ? "failed"
          : removeDisposableWorktree(input.repoRoot, worktreePath)
            ? "removed"
            : "failed";
    const cleanup = { worktree, tempRef } as const;

    const indexed = yield* indexTaskReviewTranscripts(input.persistence, {
      taskId: context.taskId,
      reviewerSessionsRoot: input.reviewerSessionsRoot,
    });

    if (worktree === "failed" || tempRef === "failed") {
      yield* input.persistence.recordCompletionFailure({
        reviewId: command.reviewId,
        operationName: "abandon_task_review_cleanup",
        errorMessage: `${command.reason} Cleanup worktree=${worktree}; temporary ref=${tempRef}.`,
        now: command.now,
      });
      return {
        ok: false as const,
        status: "cleanup_failed" as const,
        reviewId: command.reviewId,
        taskId: context.taskId,
        cleanup,
      };
    }
    if (!indexed.ok) {
      yield* input.persistence.recordCompletionFailure({
        reviewId: command.reviewId,
        operationName: "abandon_task_review_transcripts",
        errorMessage: indexed.reason,
        now: command.now,
      });
      return {
        ok: false as const,
        status: "cleanup_failed" as const,
        reviewId: command.reviewId,
        taskId: context.taskId,
        cleanup,
      };
    }

    yield* input.persistence.abandon({
      reviewId: command.reviewId,
      errorKind: "infrastructure_tooling_failed",
      operationName: "task_review_abandonment",
      errorMessage: command.reason,
      now: command.now,
    });
    return { ok: true as const, status: "abandoned" as const };
  });
