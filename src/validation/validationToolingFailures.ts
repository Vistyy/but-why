import { Data } from "effect";

import type { CleanupState } from "../validationRun/cleanup.js";
import type { ValidationToolingFailureKind } from "../validationRun/toolingErrorKind.js";
import type { ValidationWorkspaceCleanupResult } from "./validationWorkspace.js";

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

export class CheckCommandExecutionToolingFailed extends Data.TaggedError(
  "CheckCommandExecutionToolingFailed",
)<{
  readonly operationName: string;
  readonly command: string;
  readonly message: string;
}> {}

export class ReviewerOutputContractFailed extends Data.TaggedError("ReviewerOutputContractFailed")<{
  readonly operationName: string;
  readonly reviewer: string;
  readonly attempts: number;
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
  | ValidationWorkspaceSetupFailed
  | InfrastructureToolingFailed
  | GitToolingFailed
  | SandcastleToolingFailed
  | SandboxingUnavailable
  | CheckCommandExecutionToolingFailed
  | ReviewerOutputContractFailed
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
