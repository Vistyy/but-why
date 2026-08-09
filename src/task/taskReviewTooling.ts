export type TaskReviewToolingFailureKind =
  | "task_review_workspace_setup_failed"
  | "infrastructure_tooling_failed"
  | "git_tooling_failed"
  | "sandcastle_tooling_failed"
  | "prepare_command_execution_tooling_failed"
  | "reviewer_output_contract_failed";

export type TaskReviewToolingFailureRecord = {
  readonly errorKind: TaskReviewToolingFailureKind;
  readonly operationName: string;
  readonly errorMessage: string;
};

export const taskReviewToolingFailureRecord = (input: {
  readonly errorKind: TaskReviewToolingFailureKind;
  readonly operationName: string;
  readonly errorMessage: string;
}): TaskReviewToolingFailureRecord => input;
