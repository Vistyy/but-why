import type { CleanupState } from "../validationRun/cleanup.js";

export type ValidationSandboxMode = "none" | "docker" | "podman";

export type ValidationWorkspaceCleanupResult = {
  readonly worktree: CleanupState;
  readonly tempRef: CleanupState;
};

export type ActiveValidationWorkspace = {
  readonly sandbox: {
    readonly exec: (
      command: string,
      options?: { readonly cwd?: string },
    ) => Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }>;
  };
  readonly worktreePath: string;
};

export type ActiveValidationWorkspaceResult = {
  readonly checkFindings: 0 | 1;
};

export type ValidationWorkspaceSetup = {
  readonly validationRunId: string;
  readonly tempRefName: string;
  readonly submittedSha: string;
  readonly worktreeHead: string;
  readonly cleanupResult: ValidationWorkspaceCleanupResult;
};

export type ValidationWorkspaceToolingError = {
  readonly operationName: string;
  readonly tempRefName: string;
  readonly submittedSha: string;
  readonly worktreePath?: string;
  readonly errorMessage: string;
  readonly cleanupResult: ValidationWorkspaceCleanupResult;
};
