import { cleanupExactDisposableWorkspace } from "../../disposableWorkspace/disposableWorkspaceGit.js";
import type { ValidationWorkspaceCleanup } from "./validationWorkspaceCleanup.js";
import {
  expectedValidationWorkspacePath,
  validationTempRefName,
} from "./validationWorkspacePath.js";

export const validationWorkspaceCleanupGit = (repoRoot: string): ValidationWorkspaceCleanup => ({
  cleanup: (input) => {
    const expectedTempRefName = validationTempRefName(input.validationRunId);
    return cleanupExactDisposableWorkspace(repoRoot, {
      expectedTempRefName,
      expectedWorktreePath: expectedValidationWorkspacePath(repoRoot, expectedTempRefName),
      expectedCommitSha: input.submittedSha,
      ...(input.recordedTempRefName === undefined
        ? {}
        : { recordedTempRefName: input.recordedTempRefName }),
      ...(input.recordedWorktreePath === undefined
        ? {}
        : { recordedWorktreePath: input.recordedWorktreePath }),
    });
  },
});
