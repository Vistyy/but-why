import { Data, Effect } from "effect";
import {
  runValidationCommandEffect,
  type ValidationCommandEffectExecutor,
} from "../change/validation/runValidationCommand.js";

export type RepositoryPreparationEffectExecutor = ValidationCommandEffectExecutor;

class RepositoryPreparationExecutionFailed extends Data.TaggedError(
  "RepositoryPreparationExecutionFailed",
)<{
  readonly message: string;
}> {}

export type RepositoryPreparationResult = {
  readonly command: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
};

export const runRepositoryPreparationEffect = (input: {
  readonly prepare: { readonly command: string; readonly timeoutSeconds: number };
  readonly exec: RepositoryPreparationEffectExecutor;
  readonly cwd?: string;
}): Effect.Effect<RepositoryPreparationResult, RepositoryPreparationExecutionFailed> =>
  runValidationCommandEffect({
    command: input.prepare.command,
    timeoutSeconds: input.prepare.timeoutSeconds,
    completionMarker: "__BUTWHY_PREPARE_COMPLETED_prepare__",
    missingTimeoutMessage: "Could not find timeout command for prepare.",
    exec: input.exec,
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
  }).pipe(
    Effect.map((result) => ({ command: input.prepare.command, ...result })),
    Effect.mapError(
      (error) => new RepositoryPreparationExecutionFailed({ message: error.message }),
    ),
  );
