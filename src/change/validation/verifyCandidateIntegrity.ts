import { Effect } from "effect";
import type { WorkspaceCommandExecutor } from "../../command/workspaceCommand.js";

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
  Effect.tryPromise({
    try: (signal) =>
      ensureCandidateIntegrity({
        commandExecutor: input.commandExecutor,
        commandCwd: input.commandCwd,
        expectedHeadSha: input.expectedHeadSha,
        allowedUntrackedFiles: input.allowedUntrackedFiles,
        signal,
      }),
    catch: (error) =>
      error instanceof Error && "_tag" in error
        ? (error as ValidationToolingFailure)
        : new InfrastructureToolingFailed({
            operationName: input.operationName,
            message: error instanceof Error ? error.message : String(error),
          }),
  });
