import { cleanupExactDisposableWorkspace } from "../../../disposableWorkspace/adapters/disposableWorkspaceGit.js";
import type { SnapshotWorkspaceCleanup } from "../snapshotWorkspaceCleanup.js";
import { snapshotWorkspaceId } from "../snapshotWorkspacePath.js";

export const snapshotWorkspaceCleanupGit = (
  repositoryRoot: string,
  repositoryCommonDirectory: string,
): SnapshotWorkspaceCleanup => ({
  cleanup: (input) =>
    cleanupExactDisposableWorkspace(repositoryRoot, repositoryCommonDirectory, {
      workspaceId: snapshotWorkspaceId(input.validationRunId),
      expectedCommitSha: input.submittedSha,
    }),
});
