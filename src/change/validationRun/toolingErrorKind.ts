export type ValidationToolingFailureKind =
  | "snapshot_workspace_setup_failed"
  | "infrastructure_tooling_failed"
  | "git_tooling_failed"
  | "reviewer_process_execution_failed"
  | "prepare_command_execution_tooling_failed"
  | "check_command_execution_tooling_failed"
  | "reviewer_output_contract_failed"
  | "token_usage_contract_failed";
