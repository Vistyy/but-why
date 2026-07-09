import type { CleanupState } from "./cleanup.js";
import type { ValidationToolingFailureKind } from "./toolingErrorKind.js";
import type { TaskContextSnapshotV1 } from "./taskContextSnapshot.js";
import type {
  ValidationPhase,
  ValidationPhaseStatus,
  ValidationRunArtifactRecord,
  ValidationRunFindingRecord,
  ValidationRunPhaseStatusRecord,
  ValidationRunRecord,
  ValidationRunRoundRecord,
} from "./validationRun.js";

export type ValidationRunStore = {
  readonly getValidationRunById: (validationRunId: string) => ValidationRunRecord | undefined;
  readonly getLatestValidationRunIdForTask: (taskId: string) => string | null;
  readonly getTaskContextSnapshot: (validationRunId: string) => TaskContextSnapshotV1 | null;
  readonly listValidationRunSummariesForTask: (
    taskId: string,
  ) => readonly ValidationRunSummaryRecord[];
  readonly getValidationWorkspaceSetup: (
    validationRunId: string,
  ) => ValidationWorkspaceSetupRecord | undefined;
  readonly listValidationRunToolingErrors: (
    validationRunId: string,
  ) => readonly ValidationRunToolingErrorRecord[];
  readonly listValidationRunPhaseStatuses: (
    validationRunId: string,
  ) => readonly ValidationRunPhaseStatusRecord[];
  readonly listValidationRunRounds: (
    validationRunId: string,
  ) => readonly ValidationRunRoundRecord[];
  readonly listValidationRunFindings: (
    validationRunId: string,
  ) => readonly ValidationRunFindingRecord[];
  readonly listValidationRunArtifacts: (
    validationRunId: string,
  ) => readonly ValidationRunArtifactRecord[];
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

export type ValidationRunSummaryRecord = Pick<
  ValidationRunRecord,
  "id" | "taskValidationNumber" | "status" | "branch" | "commitSha" | "createdAt" | "updatedAt"
> & {
  readonly findingCount: number;
  readonly toolingFailureCount: number;
};

export type RecordValidationRunErrorInput = {
  readonly validationRunId: string;
  readonly now: string;
};

export type RecordValidationWorkspaceSetupInput = {
  readonly validationRunId: string;
  readonly tempRefName: string;
  readonly submittedSha: string;
  readonly worktreeHead: string;
  readonly cleanupWorktree: CleanupState;
  readonly cleanupTempRef: CleanupState;
  readonly now: string;
};

export type ValidationWorkspaceSetupRecord = Omit<RecordValidationWorkspaceSetupInput, "now"> & {
  readonly createdAt: string;
};

export type ValidationRunToolingErrorKind = ValidationToolingFailureKind;

export type RecordValidationRunToolingErrorInput = {
  readonly validationRunId: string;
  readonly errorKind: ValidationRunToolingErrorKind;
  readonly operationName: string;
  readonly tempRefName?: string;
  readonly submittedSha?: string;
  readonly worktreePath?: string;
  readonly errorMessage: string;
  readonly cleanupWorktree?: CleanupState;
  readonly cleanupTempRef?: CleanupState;
  readonly now: string;
};

export type ValidationRunToolingErrorRecord = Omit<
  RecordValidationRunToolingErrorInput,
  "now" | "taskRecoveryState"
> & {
  readonly sequence: number;
  readonly createdAt: string;
};

export type RecordValidationRunPhaseStatusInput = {
  readonly validationRunId: string;
  readonly phase: ValidationPhase;
  readonly status: ValidationPhaseStatus;
  readonly errorMessage?: string;
  readonly now: string;
};

export type RecordValidationRunCommandRoundInput = {
  readonly validationRunId: string;
  readonly phase: ValidationPhase;
  readonly producer: string;
  readonly roundNumber: number;
  readonly roundStatus: ValidationPhaseStatus;
  readonly phaseStatus: ValidationPhaseStatus;
  readonly artifactRecords: readonly Omit<ValidationRunArtifactRecord, "createdAt">[];
  readonly finding?: Omit<ValidationRunFindingRecord, "createdAt" | "updatedAt">;
  readonly now: string;
};

export type RecordValidationRunCheckRoundInput = Omit<
  RecordValidationRunCommandRoundInput,
  "phase"
>;

export type RecordValidationRunPrepareRoundInput = Omit<
  RecordValidationRunCommandRoundInput,
  "phase" | "producer"
>;

export type RecordValidationRunErrorResult =
  | {
      readonly ok: true;
    }
  | {
      readonly ok: false;
      readonly code: "VALIDATION_RUN_NOT_FOUND";
    };
