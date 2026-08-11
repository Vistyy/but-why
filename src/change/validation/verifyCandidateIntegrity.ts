import { Effect } from "effect";
import {
  WorkspaceCommandExecutionFailed,
  type WorkspaceCommandExecutor,
} from "../../command/workspaceCommand.js";

import { ensureCandidateIntegrity } from "./ensureCandidateIntegrity.js";
import {
  InfrastructureToolingFailed,
  type ValidationToolingFailure,
} from "./validationToolingFailures.js";

export const verifyCandidateIntegrity = (input: {
  readonly commandExecutor: WorkspaceCommandExecutor;
  readonly commandCwd: string;
  readonly expectedHeadSha: string;
  readonly allowedUntrackedFiles: readonly string[];
  readonly operationName: string;
}): Effect.Effect<void, ValidationToolingFailure> =>
  ensureCandidateIntegrity({
    commandExecutor: input.commandExecutor,
    commandCwd: input.commandCwd,
    expectedHeadSha: input.expectedHeadSha,
    allowedUntrackedFiles: input.allowedUntrackedFiles,
  }).pipe(
    Effect.mapError((error) =>
      error instanceof WorkspaceCommandExecutionFailed
        ? new InfrastructureToolingFailed({
            operationName: input.operationName,
            message: error.message,
          })
        : error,
    ),
  );
