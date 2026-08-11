import type { Effect } from "effect";
import type { SnapshotWorkspaceCleanupResult } from "./snapshotWorkspace.js";

export type SnapshotWorkspaceCleanup = {
  readonly cleanup: (input: {
    readonly validationRunId: string;
    readonly submittedSha: string;
    readonly recordedWorktreePath?: string;
  }) => Effect.Effect<SnapshotWorkspaceCleanupResult & { readonly errorMessage?: string }>;
};
