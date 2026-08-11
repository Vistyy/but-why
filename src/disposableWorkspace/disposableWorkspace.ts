import type { WorkspaceCommandExecutor } from "../command/workspaceCommand.js";

export type DisposableWorkspaceCleanupState = "not_created" | "removed" | "failed";

export type DisposableWorkspaceCleanupResult = {
  readonly workspace: DisposableWorkspaceCleanupState;
};

export type DisposableWorkspace = {
  readonly commandExecutor: WorkspaceCommandExecutor;
  readonly worktreePath: string;
};

export type DisposableWorkspaceSetup = {
  readonly workspaceId: string;
  readonly commitSha: string;
  readonly workspaceHead?: string;
  readonly worktreePath: string;
  readonly cleanupResult: DisposableWorkspaceCleanupResult;
};

export type DisposableWorkspaceError = {
  readonly operationName: string;
  readonly workspaceId: string;
  readonly commitSha: string;
  readonly worktreePath: string;
  readonly errorMessage: string;
  readonly cleanupResult: DisposableWorkspaceCleanupResult;
};
