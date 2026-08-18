import type { WorkspaceCommandExecutor } from "../command/workspaceCommand.js";

export type DisposableWorkspaceCleanupState = "not_created" | "removed" | "failed";

export type DisposableWorkspaceCleanupResult = {
  readonly workspace: DisposableWorkspaceCleanupState;
  readonly errorMessage?: string;
};

export type DisposableWorktreeInspection =
  | { readonly state: "absent" }
  | { readonly state: "matching"; readonly dirty: boolean }
  | { readonly state: "unproven"; readonly message: string };

export type ExactDisposableWorkspaceCleanupInput = {
  readonly workspaceId: string;
  readonly expectedCommitSha: string;
};

export type ExactDisposableWorkspaceCleanupResult = DisposableWorkspaceCleanupResult;

export type DisposableWorkspaceOperationName =
  | "create_disposable_workspace"
  | "cleanup_disposable_workspace";

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
