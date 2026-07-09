import type { TaskState } from "../task/lifecycle.js";
import type { SubmitEligibleState } from "../task/submitPolicy.js";
import type { PublicTaskId } from "../task/taskId.js";
import type { TaskContextSnapshotOperationName } from "../validationRun/taskContextSnapshot.js";
import type {
  RecordValidationRunCheckRoundInput,
  RecordValidationRunPhaseStatusInput,
  RecordValidationRunPrepareRoundInput,
} from "../validationRun/validationRunStore.js";
import type {
  RecordValidationCommandRoundResult,
  RecordValidationPhaseStatusResult,
  RecordValidationToolingFailureInput,
  RecordValidationToolingFailureResult,
  RecoverPendingTaskContextSnapshotInput,
  RecoverPendingTaskContextSnapshotResult,
  StartValidationRunInput,
  StartValidationRunResult,
} from "../validation/validationRuns.js";

export type TaskAuthority = {
  readonly taskPrefix: string;
  readonly resolveTaskId: (taskId: PublicTaskId) => TaskAuthorityTaskIdResolution;
  readonly getTaskSubmitReadiness: (taskId: PublicTaskId) => TaskSubmitReadinessResult;
  readonly recoverPendingTaskContextSnapshot: (
    input: RecoverPendingTaskContextSnapshotInput,
  ) => RecoverPendingTaskContextSnapshotResult;
  readonly startValidation: (input: StartValidationRunInput) => TaskAuthorityStartValidationResult;
  readonly recordValidationToolingFailure: (
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

export type TaskAuthorityStartValidationResult =
  | StartValidationRunResult
  | {
      readonly ok: false;
      readonly code: "TASK_CONTEXT_SNAPSHOT_FAILED";
      readonly operationName: TaskContextSnapshotOperationName;
      readonly message: string;
    };

export type TaskAuthorityTaskIdResolution =
  | {
      readonly ok: true;
      readonly taskId: PublicTaskId;
    }
  | {
      readonly ok: false;
      readonly code: "remote_tasks_not_supported";
      readonly taskId: PublicTaskId;
      readonly help: string;
    };

export type TaskSubmitReadinessResult =
  | {
      readonly ok: true;
      readonly taskId: PublicTaskId;
      readonly previousTaskState: SubmitEligibleState;
    }
  | {
      readonly ok: false;
      readonly code: "TASK_NOT_FOUND";
    }
  | {
      readonly ok: false;
      readonly code: "TASK_STATE_NOT_SUBMITTABLE";
      readonly state: TaskState;
    };
