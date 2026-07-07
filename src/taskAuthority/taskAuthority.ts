import type { TaskState } from "../task/lifecycle.js";
import type { SubmitEligibleState } from "../task/submitPolicy.js";
import type { PublicTaskId } from "../task/taskId.js";
import type {
  RecordValidationToolingFailureInput,
  RecordValidationToolingFailureResult,
  StartValidationRunInput,
  StartValidationRunResult,
} from "../validation/validationRuns.js";

export type TaskAuthority = {
  readonly taskPrefix: string;
  readonly resolveTaskId: (taskId: PublicTaskId) => TaskAuthorityTaskIdResolution;
  readonly getTaskSubmitReadiness: (taskId: PublicTaskId) => TaskSubmitReadinessResult;
  readonly startValidation: (input: StartValidationRunInput) => StartValidationRunResult;
  readonly recordValidationToolingFailure: (
    input: RecordValidationToolingFailureInput,
  ) => RecordValidationToolingFailureResult;
};

export type TaskAuthorityStartValidationResult = StartValidationRunResult;

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
