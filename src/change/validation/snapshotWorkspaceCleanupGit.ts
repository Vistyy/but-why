import {
  cleanupExactDisposableWorkspace,
  cleanupPreNativeDisposableWorkspace,
} from "../../disposableWorkspace/disposableWorkspaceGit.js";
import type { SnapshotWorkspaceCleanup } from "./snapshotWorkspaceCleanup.js";

export const snapshotWorkspaceCleanupGit = (
  mainCheckoutRoot: string,
): SnapshotWorkspaceCleanup => ({
  cleanup: (input) =>
    input.preNativeRefName === undefined
      ? cleanupExactDisposableWorkspace(mainCheckoutRoot, {
          workspaceId: input.validationRunId,
          expectedCommitSha: input.submittedSha,
          ...(input.recordedWorktreePath === undefined
            ? {}
            : { recordedWorktreePath: input.recordedWorktreePath }),
        })
      : cleanupPreNativeDisposableWorkspace(mainCheckoutRoot, {
          workspaceId: input.validationRunId,
          expectedCommitSha: input.submittedSha,
          recordedRefName: input.preNativeRefName,
          ...(input.recordedWorktreePath === undefined
            ? {}
            : { recordedWorktreePath: input.recordedWorktreePath }),
        }),
});
