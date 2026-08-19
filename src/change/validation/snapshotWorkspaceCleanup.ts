import type { Effect } from "effect";
import type { SnapshotWorkspaceCleanupResult } from "./snapshotWorkspace.js";

export type SnapshotWorkspaceCleanup = {
  readonly cleanup: (input: {
    readonly validationRunId: number;
    readonly submittedSha: string;
  }) => Effect.Effect<SnapshotWorkspaceCleanupResult>;
};
