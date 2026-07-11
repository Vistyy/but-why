export type ValidationToolingFailureKind =
  | "task_context_snapshot_failed"
  | "validation_workspace_setup_failed"
  | "infrastructure_tooling_failed"
  | "git_tooling_failed"
  | "sandcastle_tooling_failed"
  | "agent_harness_launch_failed"
  | "sandboxing_unavailable"
  | "prepare_command_execution_tooling_failed"
  | "check_command_execution_tooling_failed"
  | "reviewer_output_contract_failed"
  | "token_usage_contract_failed"
  | "github_publishing_tooling_failed"
  | "github_polling_tooling_failed";
