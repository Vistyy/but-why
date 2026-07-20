export type ValidationToolingFailureKind =
  | "validation_workspace_setup_failed"
  | "infrastructure_tooling_failed"
  | "git_tooling_failed"
  | "sandcastle_tooling_failed"
  | "prepare_command_execution_tooling_failed"
  | "check_command_execution_tooling_failed"
  | "reviewer_output_contract_failed"
  | "token_usage_contract_failed";
