import { Effect } from "effect";

import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import {
  type ActiveDisposableWorkspace,
  createDisposableWorkspace,
  type DisposableWorkspaceSetup,
  type DisposableWorkspaceToolingError,
} from "../workspace/disposableWorkspace.js";
import type { TaskReviewWorkspaceSetup } from "./taskReview.js";

export const taskReviewTempRefName = (reviewId: string): string =>
  `refs/but-why/task-reviews/${reviewId}/review`;

export type TaskReviewWorkspaceToolingError = {
  readonly operationName: string;
  readonly tempRefName: string;
  readonly submittedSha: string;
  readonly worktreePath?: string;
  readonly errorMessage: string;
  readonly cleanupResult: {
    readonly worktree: "removed" | "not_created" | "failed";
    readonly tempRef: "removed" | "not_created" | "failed";
  };
};

export type TaskReviewWorkspaceResult<R> =
  | {
      readonly ok: true;
      readonly setup: TaskReviewWorkspaceSetup;
      readonly activeWorkspaceResult?: R;
    }
  | {
      readonly ok: false;
      readonly toolingError: TaskReviewWorkspaceToolingError;
    };

export type TaskReviewWorkspaceInput<R, E> = {
  readonly repoRoot: string;
  readonly reviewId: string;
  readonly submittedSha: string;
  readonly copyFiles: readonly string[];
  readonly recordWorkspaceSetup: (
    setup: TaskReviewWorkspaceSetup,
  ) => Effect.Effect<void, RepositoryStorageError>;
  readonly recordInterruptedCleanupResult?: (
    toolingError: TaskReviewWorkspaceToolingError,
  ) => Effect.Effect<void, unknown>;
  readonly runInWorkspace?: (
    workspace: ActiveDisposableWorkspace,
  ) => Effect.Effect<R, E | RepositoryStorageError>;
};

export const createTaskReviewWorkspace = <R, E>(
  input: TaskReviewWorkspaceInput<R, E>,
): Effect.Effect<TaskReviewWorkspaceResult<R>, E | RepositoryStorageError> => {
  const recordWorkspaceSetup = input.recordWorkspaceSetup;
  const recordInterruptedCleanupResult = input.recordInterruptedCleanupResult;
  const runInWorkspace = input.runInWorkspace;
  return createDisposableWorkspace<R, E>({
    repoRoot: input.repoRoot,
    runId: input.reviewId,
    tempRefName: taskReviewTempRefName(input.reviewId),
    submittedSha: input.submittedSha,
    copyFiles: input.copyFiles,
    ...(recordWorkspaceSetup === undefined
      ? {}
      : {
          recordWorkspaceSetup: (setup) => recordWorkspaceSetup(toTaskReviewWorkspaceSetup(setup)),
        }),
    ...(recordInterruptedCleanupResult === undefined
      ? {}
      : {
          recordInterruptedCleanupResult: (toolingError) =>
            recordInterruptedCleanupResult(toTaskReviewWorkspaceToolingError(toolingError)),
        }),
    ...(runInWorkspace === undefined ? {} : { runInWorkspace }),
  }).pipe(
    Effect.map((result): TaskReviewWorkspaceResult<R> => {
      if (result.ok) {
        return {
          ok: true,
          setup: toTaskReviewWorkspaceSetup(result.setup),
          ...(result.activeWorkspaceResult === undefined
            ? {}
            : { activeWorkspaceResult: result.activeWorkspaceResult }),
        };
      }
      return { ok: false, toolingError: toTaskReviewWorkspaceToolingError(result.toolingError) };
    }),
  );
};

const toTaskReviewWorkspaceSetup = (setup: DisposableWorkspaceSetup): TaskReviewWorkspaceSetup => ({
  reviewId: setup.runId,
  tempRefName: setup.tempRefName,
  submittedSha: setup.submittedSha,
  worktreeHead: setup.worktreeHead,
  ...(setup.worktreePath === undefined ? {} : { worktreePath: setup.worktreePath }),
  cleanupWorktree: setup.cleanupResult.worktree,
  cleanupTempRef: setup.cleanupResult.tempRef,
  createdAt: "",
});

const toTaskReviewWorkspaceToolingError = (
  toolingError: DisposableWorkspaceToolingError,
): TaskReviewWorkspaceToolingError => ({
  operationName: toolingError.operationName,
  tempRefName: toolingError.tempRefName,
  submittedSha: toolingError.submittedSha,
  ...(toolingError.worktreePath === undefined ? {} : { worktreePath: toolingError.worktreePath }),
  errorMessage: toolingError.errorMessage,
  cleanupResult: toolingError.cleanupResult,
});
