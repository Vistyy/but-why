import type { CleanupState } from "./cleanup.js";
import type { RunRecord } from "./run.js";

export type RunStore = {
  readonly getRunById: (runId: string) => RunRecord | undefined;
  readonly getLatestRunIdForTask: (taskId: string) => string | null;
  readonly getValidationWorkspaceSetup: (
    runId: string,
  ) => ValidationWorkspaceSetupRecord | undefined;
  readonly listRunToolingErrors: (runId: string) => readonly RunToolingErrorRecord[];
  readonly recordRunError: (input: RecordRunErrorInput) => RecordRunErrorResult;
  readonly recordValidationWorkspaceSetup: (
    input: RecordValidationWorkspaceSetupInput,
  ) => RecordRunErrorResult;
  readonly recordRunToolingError: (input: RecordRunToolingErrorInput) => RecordRunErrorResult;
};

export type RecordRunErrorInput = {
  readonly runId: string;
  readonly now: string;
};

export type RecordValidationWorkspaceSetupInput = {
  readonly runId: string;
  readonly tempRefName: string;
  readonly submittedSha: string;
  readonly worktreePath: string;
  readonly worktreeHead: string;
  readonly cleanupWorktree: CleanupState;
  readonly cleanupTempRef: CleanupState;
  readonly now: string;
};

export type ValidationWorkspaceSetupRecord = Omit<RecordValidationWorkspaceSetupInput, "now"> & {
  readonly createdAt: string;
};

export type RecordRunToolingErrorInput = {
  readonly runId: string;
  readonly operationName: string;
  readonly tempRefName: string;
  readonly submittedSha: string;
  readonly worktreePath?: string;
  readonly errorMessage: string;
  readonly cleanupWorktree: CleanupState;
  readonly cleanupTempRef: CleanupState;
  readonly now: string;
};

export type RunToolingErrorRecord = Omit<
  RecordRunToolingErrorInput,
  "now" | "taskRecoveryState"
> & {
  readonly sequence: number;
  readonly createdAt: string;
};

export type RecordRunErrorResult =
  | {
      readonly ok: true;
    }
  | {
      readonly ok: false;
      readonly code: "RUN_NOT_FOUND";
    };
