import type { CleanupState } from "../validationRun/cleanup.js";

export type ValidationWorkspaceCleanup = {
  readonly tempRefName: (validationRunId: string) => string;
  readonly expectedWorktreePath: (tempRefName: string) => string;
  readonly removeWorktree: (worktreePath: string) => boolean;
  readonly deleteTempRef: (tempRefName: string) => CleanupState;
};
