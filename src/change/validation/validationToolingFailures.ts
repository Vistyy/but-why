import { Data } from "effect";

import type { ContractDiagnostic } from "../../contracts/contractDiagnostics.js";
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

export class ReviewerOutputContractFailed extends Data.TaggedError("ReviewerOutputContractFailed")<{
  readonly operationName: string;
  readonly reviewer: string;
  readonly attempts: number;
  readonly diagnostics: readonly ContractDiagnostic[];
  readonly message: string;
}> {}

export class TokenUsageContractFailed extends Data.TaggedError("TokenUsageContractFailed")<{
  readonly operationName: string;
  readonly diagnostics: readonly ContractDiagnostic[];
  readonly message: string;
}> {}

export type ValidationToolingFailure =
  | ValidationWorkspaceSetupFailed
  | InfrastructureToolingFailed
  | GitToolingFailed
  | SandcastleToolingFailed
  | PrepareCommandExecutionToolingFailed
  | CheckCommandExecutionToolingFailed
  | ReviewerOutputContractFailed
  | TokenUsageContractFailed;

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
    case "PrepareCommandExecutionToolingFailed":
      return {
        errorKind: "prepare_command_execution_tooling_failed",
        operationName: failure.operationName,
        errorMessage: `${failure.message} Command: ${failure.command}.`,
      };
    case "CheckCommandExecutionToolingFailed":
      return {
        errorKind: "check_command_execution_tooling_failed",
        operationName: failure.operationName,
        errorMessage: `${failure.message} Command: ${failure.command}.`,
      };
    case "ReviewerOutputContractFailed":
      return {
        errorKind: "reviewer_output_contract_failed",
        operationName: failure.operationName,
        errorMessage: `${failure.message} Reviewer: ${failure.reviewer}. Attempts: ${failure.attempts}.`,
      };
    case "TokenUsageContractFailed":
      return {
        errorKind: "token_usage_contract_failed",
        operationName: failure.operationName,
        errorMessage: failure.message,
      };
  }
};
