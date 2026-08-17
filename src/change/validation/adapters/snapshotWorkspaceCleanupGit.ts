import { cleanupExactDisposableWorkspace } from "../../../disposableWorkspace/adapters/disposableWorkspaceGit.js";
import type { SnapshotWorkspaceCleanup } from "../snapshotWorkspaceCleanup.js";
import { expectedSnapshotWorkspacePath, snapshotWorkspaceId } from "../snapshotWorkspacePath.js";

export const snapshotWorkspaceCleanupGit = (
  mainCheckoutRoot: string,
): SnapshotWorkspaceCleanup => ({
  cleanup: (input) =>
    cleanupExactDisposableWorkspace(mainCheckoutRoot, {
      workspaceId: snapshotWorkspaceId(input.validationRunId),
      expectedCommitSha: input.submittedSha,
      recordedWorktreePath:
        input.recordedWorktreePath ??
        expectedSnapshotWorkspacePath(mainCheckoutRoot, input.validationRunId),
    }),
});
