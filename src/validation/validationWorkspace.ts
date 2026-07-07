import type { CleanupState } from "../run/cleanup.js";

export type ValidationWorkspaceCleanupResult = {
  readonly worktree: CleanupState;
  readonly tempRef: CleanupState;
};

export type ValidationWorkspaceSetup = {
  readonly runId: string;
  readonly tempRefName: string;
  readonly submittedSha: string;
  readonly worktreePath: string;
  readonly worktreeHead: string;
  readonly cleanupResult: ValidationWorkspaceCleanupResult;
};

export type ValidationWorkspaceToolingError = {
  readonly operationName: string;
  readonly tempRefName: string;
  readonly submittedSha: string;
  readonly worktreePath?: string;
  readonly errorMessage: string;
  readonly cleanupResult: ValidationWorkspaceCleanupResult;
};
