import type { WorkspaceCommandExecutor } from "../command/workspaceCommand.js";

export type DisposableWorkspaceCleanupState = "not_created" | "removed" | "failed";

export type DisposableWorkspaceCleanupResult = {
  readonly workspace: DisposableWorkspaceCleanupState;
};

export type DisposableWorkspaceOperationName =
  | "create_disposable_workspace"
  | "cleanup_disposable_workspace"
  | "copy_allowlisted_file"
  | "disposable_workspace_interrupted";

export type DisposableWorkspace = {
  readonly commandExecutor: WorkspaceCommandExecutor;
  readonly worktreePath: string;
};

export type DisposableWorkspaceError = {
  readonly operationName: DisposableWorkspaceOperationName;
  readonly workspaceId: string;
  readonly commitSha: string;
  readonly worktreePath: string;
  readonly errorMessage: string;
  readonly cleanupResult: DisposableWorkspaceCleanupResult;
};
