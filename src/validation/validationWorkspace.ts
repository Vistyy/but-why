import type { Sandbox } from "@ai-hero/sandcastle";

import type { CleanupState } from "../validationRun/cleanup.js";

export type ValidationSandboxMode = "none" | "docker" | "podman";

export type ValidationWorkspaceCleanupResult = {
  readonly worktree: CleanupState;
  readonly tempRef: CleanupState;
};

export type ActiveValidationWorkspace = {
  readonly sandbox: Pick<Sandbox, "exec" | "run">;
  readonly worktreePath: string;
};

export type ActiveValidationWorkspaceResult = {
  readonly validationFindings: 0 | 1;
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
