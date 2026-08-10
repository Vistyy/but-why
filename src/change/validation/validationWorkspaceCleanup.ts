import type { ValidationWorkspaceCleanupResult } from "./validationWorkspace.js";

export type ValidationWorkspaceCleanup = {
  readonly cleanup: (input: {
    readonly validationRunId: string;
    readonly submittedSha: string;
    readonly recordedTempRefName?: string;
    readonly recordedWorktreePath?: string;
  }) => ValidationWorkspaceCleanupResult & { readonly errorMessage?: string };
};
