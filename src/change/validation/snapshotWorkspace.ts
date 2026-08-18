import type { WorkspaceCommandExecutor } from "../../command/workspaceCommand.js";
import type { CandidateValidationOutcome } from "../candidateValidation/candidateValidationRunStore.js";
import type { CleanupState } from "../validationRun/cleanup.js";

export type SnapshotWorkspaceCleanupResult = {
  readonly workspace: CleanupState;
};

export type ActiveSnapshotWorkspace = {
  readonly commandExecutor: WorkspaceCommandExecutor;
  readonly worktreePath: string;
};

export type ActiveSnapshotWorkspaceResult = {
  readonly outcome: CandidateValidationOutcome;
};

export type SnapshotWorkspaceOperationName =
  | "create_snapshot_workspace"
  | "cleanup_snapshot_workspace"
  | "copy_allowlisted_file";

export type SnapshotWorkspaceToolingError = {
  readonly operationName: SnapshotWorkspaceOperationName;
  readonly validationRunId: number;
  readonly expectedCommitSha: string;
  readonly worktreePath: string;
  readonly errorMessage: string;
  readonly cleanupResult: SnapshotWorkspaceCleanupResult;
};
