import { cleanupExactDisposableWorkspace } from "../../../disposableWorkspace/adapters/disposableWorkspaceGit.js";
import type { SnapshotWorkspaceCleanup } from "../snapshotWorkspaceCleanup.js";

export const snapshotWorkspaceCleanupGit = (
  mainCheckoutRoot: string,
): SnapshotWorkspaceCleanup => ({
  cleanup: (input) =>
    cleanupExactDisposableWorkspace(mainCheckoutRoot, {
      workspaceId: input.validationRunId,
      expectedCommitSha: input.submittedSha,
      ...(input.recordedWorktreePath === undefined
        ? {}
        : { recordedWorktreePath: input.recordedWorktreePath }),
    }),
});
