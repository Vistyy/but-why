import type { Sandbox } from "@ai-hero/sandcastle";
import { Effect } from "effect";

import { ensureCandidateIntegrity } from "./ensureCandidateIntegrity.js";
import {
  InfrastructureToolingFailed,
  type ValidationToolingFailure,
} from "./validationToolingFailures.js";

export const verifyCandidateIntegrity = (input: {
  readonly sandbox: Pick<Sandbox, "exec">;
  readonly commandCwd: string;
  readonly expectedHeadSha: string;
  readonly allowedUntrackedFiles: readonly string[];
  readonly operationName: string;
}): Effect.Effect<void, ValidationToolingFailure> =>
  Effect.tryPromise({
    try: () =>
      ensureCandidateIntegrity({
        sandbox: input.sandbox,
        commandCwd: input.commandCwd,
        expectedHeadSha: input.expectedHeadSha,
        allowedUntrackedFiles: input.allowedUntrackedFiles,
      }),
    catch: (error) =>
      error instanceof Error && "_tag" in error
        ? (error as ValidationToolingFailure)
        : new InfrastructureToolingFailed({
            operationName: input.operationName,
            message: error instanceof Error ? error.message : String(error),
          }),
  });
