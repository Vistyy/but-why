import { Effect } from "effect";
import type {
  WorkspaceCommandExecutionFailed,
  WorkspaceCommandExecutor,
} from "../../command/workspaceCommand.js";
import {
  DisposableWorkspaceIntegrityFailed,
  verifyDisposableWorkspaceIntegrity,
} from "../../disposableWorkspace/disposableWorkspace.js";

import { GitToolingFailed } from "./validationToolingFailures.js";

export const ensureCandidateIntegrity = (input: {
  readonly commandExecutor: WorkspaceCommandExecutor;
  readonly commandCwd?: string;
  readonly expectedHeadSha: string;
  readonly allowedUntrackedFiles: readonly string[];
}): Effect.Effect<void, GitToolingFailed | WorkspaceCommandExecutionFailed> =>
  verifyDisposableWorkspaceIntegrity({
    commandExecutor: input.commandExecutor,
    ...(input.commandCwd === undefined ? {} : { commandCwd: input.commandCwd }),
    expectedCommitSha: input.expectedHeadSha,
    allowedUntrackedFiles: input.allowedUntrackedFiles,
  }).pipe(
    Effect.mapError((error) =>
      error instanceof DisposableWorkspaceIntegrityFailed
        ? new GitToolingFailed({
            operationName: "verify_candidate_head",
            message: "Snapshot Workspace no longer matches the Candidate.",
          })
        : error,
    ),
  );
