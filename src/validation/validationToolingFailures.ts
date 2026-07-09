import { Data } from "effect";

import type { CleanupState } from "../validationRun/cleanup.js";
import type { ValidationToolingFailureKind } from "../validationRun/toolingErrorKind.js";
import type { TaskContextSnapshotOperationName } from "../validationRun/taskContextSnapshot.js";
import type { ValidationWorkspaceCleanupResult } from "./validationWorkspace.js";

export class TaskContextSnapshotFailed extends Data.TaggedError("TaskContextSnapshotFailed")<{
  readonly operationName: TaskContextSnapshotOperationName;
  readonly message: string;
}> {}

export class ValidationWorkspaceSetupFailed extends Data.TaggedError(
  "ValidationWorkspaceSetupFailed",
)<{
  readonly operationName: string;
  readonly tempRefName: string;
  readonly submittedSha: string;
  readonly worktreePath?: string;
  readonly errorMessage: string;
  readonly cleanupResult: ValidationWorkspaceCleanupResult;
}> {}

export class InfrastructureToolingFailed extends Data.TaggedError("InfrastructureToolingFailed")<{
  readonly operationName: string;
  readonly message: string;
}> {}

export class GitToolingFailed extends Data.TaggedError("GitToolingFailed")<{
  readonly operationName: string;
  readonly message: string;
}> {}

export class SandcastleToolingFailed extends Data.TaggedError("SandcastleToolingFailed")<{
  readonly operationName: string;
  readonly message: string;
}> {}

export class SandboxingUnavailable extends Data.TaggedError("SandboxingUnavailable")<{
  readonly operationName: string;
  readonly message: string;
}> {}

export class PrepareCommandExecutionToolingFailed extends Data.TaggedError(
  "PrepareCommandExecutionToolingFailed",
)<{
  readonly operationName: string;
  readonly command: string;
  readonly message: string;
}> {}

export class CheckCommandExecutionToolingFailed extends Data.TaggedError(
  "CheckCommandExecutionToolingFailed",
)<{
  readonly operationName: string;
  readonly command: string;
  readonly message: string;
}> {}

type ContractFailureDiagnostic = {
  readonly path: readonly (string | number)[];
  readonly expected: string;
  readonly actual: unknown;
  readonly message: string;
};

export class ReviewerOutputContractFailed extends Data.TaggedError("ReviewerOutputContractFailed")<{
  readonly operationName: string;
  readonly reviewer: string;
  readonly attempts: number;
  readonly diagnostics: readonly ContractFailureDiagnostic[];
  readonly message: string;
}> {}

export class TokenUsageContractFailed extends Data.TaggedError("TokenUsageContractFailed")<{
  readonly operationName: string;
  readonly diagnostics: readonly ContractFailureDiagnostic[];
  readonly message: string;
}> {}

export class GitHubPublishingToolingFailed extends Data.TaggedError(
  "GitHubPublishingToolingFailed",
)<{
  readonly operationName: string;
  readonly message: string;
}> {}

export class GitHubPollingToolingFailed extends Data.TaggedError("GitHubPollingToolingFailed")<{
  readonly operationName: string;
  readonly message: string;
}> {}

export type ValidationToolingFailure =
  | TaskContextSnapshotFailed
  | ValidationWorkspaceSetupFailed
  | InfrastructureToolingFailed
  | GitToolingFailed
  | SandcastleToolingFailed
  | SandboxingUnavailable
  | PrepareCommandExecutionToolingFailed
  | CheckCommandExecutionToolingFailed
  | ReviewerOutputContractFailed
  | TokenUsageContractFailed
  | GitHubPublishingToolingFailed
  | GitHubPollingToolingFailed;

export type ValidationToolingFailureRecordInput = {
  readonly errorKind: ValidationToolingFailureKind;
  readonly operationName: string;
  readonly tempRefName?: string;
  readonly submittedSha?: string;
  readonly worktreePath?: string;
  readonly errorMessage: string;
  readonly cleanupWorktree?: CleanupState;
  readonly cleanupTempRef?: CleanupState;
};

export const validationToolingFailureKind = (
  failure: ValidationToolingFailure,
): ValidationToolingFailureKind => validationToolingFailureRecord(failure).errorKind;

export const validationToolingFailureRecord = (
  failure: ValidationToolingFailure,
): ValidationToolingFailureRecordInput => {
  switch (failure._tag) {
    case "TaskContextSnapshotFailed":
      return {
        errorKind: "task_context_snapshot_failed",
        operationName: failure.operationName,
        errorMessage: failure.message,
      };
    case "ValidationWorkspaceSetupFailed":
      return {
        errorKind: "validation_workspace_setup_failed",
        operationName: failure.operationName,
        tempRefName: failure.tempRefName,
        submittedSha: failure.submittedSha,
        ...(failure.worktreePath === undefined ? {} : { worktreePath: failure.worktreePath }),
        errorMessage: failure.errorMessage,
        cleanupWorktree: failure.cleanupResult.worktree,
        cleanupTempRef: failure.cleanupResult.tempRef,
      };
    case "InfrastructureToolingFailed":
      return {
        errorKind: "infrastructure_tooling_failed",
        operationName: failure.operationName,
        errorMessage: failure.message,
      };
    case "GitToolingFailed":
      return {
        errorKind: "git_tooling_failed",
        operationName: failure.operationName,
        errorMessage: failure.message,
      };
    case "SandcastleToolingFailed":
      return {
        errorKind: "sandcastle_tooling_failed",
        operationName: failure.operationName,
        errorMessage: failure.message,
      };
    case "SandboxingUnavailable":
      return {
        errorKind: "sandboxing_unavailable",
        operationName: failure.operationName,
        errorMessage: failure.message,
      };
    case "PrepareCommandExecutionToolingFailed":
      return {
        errorKind: "prepare_command_execution_tooling_failed",
        operationName: failure.operationName,
        errorMessage: `${failure.message}: ${failure.command}`,
      };
    case "CheckCommandExecutionToolingFailed":
      return {
        errorKind: "check_command_execution_tooling_failed",
        operationName: failure.operationName,
        errorMessage: `${failure.message}: ${failure.command}`,
      };
    case "ReviewerOutputContractFailed":
      return {
        errorKind: "reviewer_output_contract_failed",
        operationName: failure.operationName,
        errorMessage: `${failure.message}: ${failure.reviewer} after ${failure.attempts} attempts`,
      };
    case "TokenUsageContractFailed":
      return {
        errorKind: "token_usage_contract_failed",
        operationName: failure.operationName,
        errorMessage: failure.message,
      };
    case "GitHubPublishingToolingFailed":
      return {
        errorKind: "github_publishing_tooling_failed",
        operationName: failure.operationName,
        errorMessage: failure.message,
      };
    case "GitHubPollingToolingFailed":
      return {
        errorKind: "github_polling_tooling_failed",
        operationName: failure.operationName,
        errorMessage: failure.message,
      };
  }
};
