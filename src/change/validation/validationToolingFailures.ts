import { Data } from "effect";

import type { ReviewerOutputContractFailed } from "../../agent/reviewerOutput.js";
import type { TokenUsageContractFailed } from "../../agent/tokenUsage.js";
import type { CleanupState } from "../validationRun/cleanup.js";
import type { ValidationToolingFailureKind } from "../validationRun/toolingErrorKind.js";
import type {
  SnapshotWorkspaceCleanupResult,
  SnapshotWorkspaceOperationName,
} from "./snapshotWorkspace.js";

export class SnapshotWorkspaceSetupFailed extends Data.TaggedError("SnapshotWorkspaceSetupFailed")<{
  readonly operationName: SnapshotWorkspaceOperationName;
  readonly validationRunId: string;
  readonly submittedSha: string;
  readonly worktreePath: string;
  readonly errorMessage: string;
  readonly cleanupResult: SnapshotWorkspaceCleanupResult;
}> {}

export class InfrastructureToolingFailed extends Data.TaggedError("InfrastructureToolingFailed")<{
  readonly operationName: string;
  readonly message: string;
}> {}

export class GitToolingFailed extends Data.TaggedError("GitToolingFailed")<{
  readonly operationName: string;
  readonly message: string;
}> {}

export class ReviewerProcessToolingFailed extends Data.TaggedError("ReviewerProcessToolingFailed")<{
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

export type ValidationToolingFailure =
  | SnapshotWorkspaceSetupFailed
  | InfrastructureToolingFailed
  | GitToolingFailed
  | ReviewerProcessToolingFailed
  | PrepareCommandExecutionToolingFailed
  | CheckCommandExecutionToolingFailed
  | ReviewerOutputContractFailed
  | TokenUsageContractFailed;

export type ValidationToolingFailureRecordInput = {
  readonly errorKind: ValidationToolingFailureKind;
  readonly operationName: string;
  readonly validationRunId?: string;
  readonly submittedSha?: string;
  readonly worktreePath?: string;
  readonly errorMessage: string;
  readonly cleanupWorkspace?: CleanupState;
};

export const validationToolingFailureRecord = (
  failure: ValidationToolingFailure,
): ValidationToolingFailureRecordInput => {
  switch (failure._tag) {
    case "SnapshotWorkspaceSetupFailed":
      return {
        errorKind: "snapshot_workspace_setup_failed",
        operationName: failure.operationName,
        validationRunId: failure.validationRunId,
        submittedSha: failure.submittedSha,
        worktreePath: failure.worktreePath,
        errorMessage: failure.errorMessage,
        cleanupWorkspace: failure.cleanupResult.workspace,
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
    case "ReviewerProcessToolingFailed":
      return {
        errorKind: "reviewer_process_execution_failed",
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
