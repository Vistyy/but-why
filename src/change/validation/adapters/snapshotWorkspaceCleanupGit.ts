import { cleanupExactDisposableWorkspace } from "../../../disposableWorkspace/adapters/disposableWorkspaceGit.js";
import { expectedDisposableWorkspacePath } from "../../../disposableWorkspace/disposableWorkspacePath.js";
import type { SnapshotWorkspaceCleanup } from "../snapshotWorkspaceCleanup.js";

export const snapshotWorkspaceCleanupGit = (
  mainCheckoutRoot: string,
): SnapshotWorkspaceCleanup => ({
  cleanup: (input) =>
    cleanupExactDisposableWorkspace(mainCheckoutRoot, {
      workspaceId: String(input.validationRunId),
      expectedCommitSha: input.submittedSha,
      recordedWorktreePath:
        input.recordedWorktreePath ??
        expectedDisposableWorkspacePath(mainCheckoutRoot, String(input.validationRunId)),
    }),
});
