import type { GitHubPrTarget } from "../validationRun/validationRun.js";
import type {
  RecordValidationRunCheckRoundInput,
  RecordValidationRunPhaseStatusInput,
  RecordValidationRunPrepareRoundInput,
} from "../validationRun/validationRunStore.js";
import type { ValidationToolingFailure } from "./validationToolingFailures.js";
import type { TaskState } from "../task/lifecycle.js";
import type { SubmitEligibleState } from "../task/submitPolicy.js";
import type { PublicTaskId } from "../task/taskId.js";

export type ValidationRuns = {
  readonly start: (input: StartValidationRunInput) => StartValidationRunResult;
  readonly recordToolingFailure: (
    input: RecordValidationToolingFailureInput,
  ) => RecordValidationToolingFailureResult;
  readonly recordPhaseStatus: (
    input: RecordValidationRunPhaseStatusInput,
  ) => RecordValidationPhaseStatusResult;
  readonly recordPrepareRound: (
    input: RecordValidationRunPrepareRoundInput,
  ) => RecordValidationCommandRoundResult;
  readonly recordCheckRound: (
    input: RecordValidationRunCheckRoundInput,
  ) => RecordValidationCommandRoundResult;
};

export type StartValidationRunInput = {
  readonly taskId: PublicTaskId;
  readonly branch: string;
  readonly commitSha: string;
  readonly prTarget: GitHubPrTarget;
  readonly now: string;
};

export type StartValidationRunResult =
  | {
      readonly ok: true;
      readonly validationRunId: string;
      readonly taskState: "validating";
      readonly previousTaskState: SubmitEligibleState;
    }
  | {
      readonly ok: false;
      readonly code:
        | "TASK_NOT_FOUND"
        | "TASK_STATE_NOT_SUBMITTABLE"
        | "BRANCH_ALREADY_BOUND"
        | "TASK_BRANCH_MISMATCH"
        | "TASK_HAS_ACTIVE_VALIDATION_RUN"
        | "TASK_AUTHORITY_UNSUPPORTED";
      readonly state?: TaskState;
      readonly boundBranch?: string;
      readonly boundTaskId?: string;
    };

export type RecordValidationToolingFailureInput = {
  readonly validationRunId: string;
  readonly toolingFailure: ValidationToolingFailure;
  readonly taskRecoveryState: SubmitEligibleState;
  readonly now: string;
};

export type RecordValidationToolingFailureResult =
  | {
      readonly ok: true;
    }
  | {
      readonly ok: false;
      readonly code: "VALIDATION_RUN_NOT_FOUND" | "TASK_AUTHORITY_UNSUPPORTED";
    };

export type RecordValidationPhaseStatusResult =
  | {
      readonly ok: true;
    }
  | {
      readonly ok: false;
      readonly code: "VALIDATION_RUN_NOT_FOUND" | "TASK_AUTHORITY_UNSUPPORTED";
    };

export type RecordValidationCommandRoundResult =
  | {
      readonly ok: true;
    }
  | {
      readonly ok: false;
      readonly code: "VALIDATION_RUN_NOT_FOUND" | "TASK_AUTHORITY_UNSUPPORTED";
    };

export const unsupportedValidationRuns = (): ValidationRuns => ({
  start: () => ({ ok: false, code: "TASK_AUTHORITY_UNSUPPORTED" }),
  recordToolingFailure: () => ({ ok: false, code: "TASK_AUTHORITY_UNSUPPORTED" }),
  recordPhaseStatus: () => ({ ok: false, code: "TASK_AUTHORITY_UNSUPPORTED" }),
  recordPrepareRound: () => ({ ok: false, code: "TASK_AUTHORITY_UNSUPPORTED" }),
  recordCheckRound: () => ({ ok: false, code: "TASK_AUTHORITY_UNSUPPORTED" }),
});
