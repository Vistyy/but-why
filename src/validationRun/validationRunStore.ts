import type { CleanupState } from "./cleanup.js";
import type { ValidationRunPhaseStatusRecord, ValidationRunRecord } from "./validationRun.js";

export type ValidationRunStore = {
  readonly getValidationRunById: (validationRunId: string) => ValidationRunRecord | undefined;
  readonly getLatestValidationRunIdForTask: (taskId: string) => string | null;
  readonly getValidationWorkspaceSetup: (
    validationRunId: string,
  ) => ValidationWorkspaceSetupRecord | undefined;
  readonly listValidationRunToolingErrors: (
    validationRunId: string,
  ) => readonly ValidationRunToolingErrorRecord[];
  readonly listValidationRunPhaseStatuses: (
    validationRunId: string,
  ) => readonly ValidationRunPhaseStatusRecord[];
  readonly recordValidationRunError: (
    input: RecordValidationRunErrorInput,
  ) => RecordValidationRunErrorResult;
  readonly recordValidationWorkspaceSetup: (
    input: RecordValidationWorkspaceSetupInput,
  ) => RecordValidationRunErrorResult;
  readonly recordValidationRunToolingError: (
    input: RecordValidationRunToolingErrorInput,
  ) => RecordValidationRunErrorResult;
};

export type RecordValidationRunErrorInput = {
  readonly validationRunId: string;
  readonly now: string;
};

export type RecordValidationWorkspaceSetupInput = {
  readonly validationRunId: string;
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

export type ValidationRunToolingErrorKind = "validation_workspace_setup_failed";

export type RecordValidationRunToolingErrorInput = {
  readonly validationRunId: string;
  readonly errorKind: ValidationRunToolingErrorKind;
  readonly operationName: string;
  readonly tempRefName: string;
  readonly submittedSha: string;
  readonly worktreePath?: string;
  readonly errorMessage: string;
  readonly cleanupWorktree: CleanupState;
  readonly cleanupTempRef: CleanupState;
  readonly now: string;
};

export type ValidationRunToolingErrorRecord = Omit<
  RecordValidationRunToolingErrorInput,
  "now" | "taskRecoveryState"
> & {
  readonly sequence: number;
  readonly createdAt: string;
};

export type RecordValidationRunErrorResult =
  | {
      readonly ok: true;
    }
  | {
      readonly ok: false;
      readonly code: "VALIDATION_RUN_NOT_FOUND";
    };
