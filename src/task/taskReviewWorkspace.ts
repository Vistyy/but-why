import { Effect } from "effect";

import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type {
  DisposableWorkspace,
  DisposableWorkspaceError,
  DisposableWorkspaceSetup,
} from "../disposableWorkspace/disposableWorkspace.js";
import { runDisposableExactCommitWorkspace } from "../disposableWorkspace/runDisposableExactCommitWorkspace.js";
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
  readonly cleanupDiagnostics?: {
    readonly worktree?: string;
    readonly tempRef?: string;
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
    workspace: DisposableWorkspace,
  ) => Effect.Effect<R, E | RepositoryStorageError>;
};

export const createTaskReviewWorkspace = <R, E>(
  input: TaskReviewWorkspaceInput<R, E>,
): Effect.Effect<TaskReviewWorkspaceResult<R>, E | RepositoryStorageError> => {
  let activeWorkspaceResult: R | undefined;
  return runDisposableExactCommitWorkspace<E | RepositoryStorageError>({
    repoRoot: input.repoRoot,
    workspaceRef: taskReviewTempRefName(input.reviewId),
    commitSha: input.submittedSha,
    copyFiles: input.copyFiles,
    recordWorkspaceSetup: (setup) =>
      input.recordWorkspaceSetup(toTaskReviewWorkspaceSetup(input.reviewId, setup)),
    ...(input.recordInterruptedCleanupResult === undefined
      ? {}
      : {
          recordInterruptedCleanupResult: (toolingError) =>
            input
              .recordInterruptedCleanupResult?.(toTaskReviewWorkspaceToolingError(toolingError))
              .pipe(Effect.ignore) ?? Effect.void,
        }),
    ...(input.runInWorkspace === undefined
      ? {}
      : {
          runInWorkspace: (workspace) =>
            input.runInWorkspace?.(workspace).pipe(
              Effect.tap((result) =>
                Effect.sync(() => {
                  activeWorkspaceResult = result;
                }),
              ),
              Effect.asVoid,
            ) ?? Effect.void,
        }),
  }).pipe(
    Effect.map(
      (result): TaskReviewWorkspaceResult<R> =>
        result.ok
          ? {
              ok: true,
              setup: toTaskReviewWorkspaceSetup(input.reviewId, result.setup),
              ...(activeWorkspaceResult === undefined ? {} : { activeWorkspaceResult }),
            }
          : { ok: false, toolingError: toTaskReviewWorkspaceToolingError(result.toolingError) },
    ),
  );
};

const toTaskReviewWorkspaceSetup = (
  reviewId: string,
  setup: DisposableWorkspaceSetup,
): TaskReviewWorkspaceSetup => ({
  reviewId,
  tempRefName: setup.tempRefName,
  submittedSha: setup.commitSha,
  worktreeHead: setup.worktreeHead,
  ...(setup.worktreePath === undefined ? {} : { worktreePath: setup.worktreePath }),
  cleanupWorktree: setup.cleanupResult.worktree,
  cleanupTempRef: setup.cleanupResult.tempRef,
  createdAt: "",
});

const toTaskReviewWorkspaceToolingError = (
  toolingError: DisposableWorkspaceError,
): TaskReviewWorkspaceToolingError => ({
  operationName: toolingError.operationName,
  tempRefName: toolingError.tempRefName,
  submittedSha: toolingError.commitSha,
  ...(toolingError.worktreePath === undefined ? {} : { worktreePath: toolingError.worktreePath }),
  errorMessage: toolingError.errorMessage,
  cleanupResult: toolingError.cleanupResult,
  ...(toolingError.cleanupDiagnostics === undefined
    ? {}
    : { cleanupDiagnostics: toolingError.cleanupDiagnostics }),
});
