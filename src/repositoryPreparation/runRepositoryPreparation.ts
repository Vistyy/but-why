import { Data, Effect } from "effect";
import {
  runValidationCommand,
  runValidationCommandEffect,
  type ValidationCommandEffectExecutor,
  type ValidationCommandExecutor,
} from "../change/validation/runValidationCommand.js";

export type RepositoryPreparationExecutor = ValidationCommandExecutor;
export type RepositoryPreparationEffectExecutor = RepositoryPreparationExecutor & {
  readonly effect: ValidationCommandEffectExecutor;
};

export class RepositoryPreparationExecutionFailed extends Data.TaggedError(
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
    exec: input.exec.effect,
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
  }).pipe(
    Effect.map((result) => ({ command: input.prepare.command, ...result })),
    Effect.mapError(
      (error) => new RepositoryPreparationExecutionFailed({ message: error.message }),
    ),
  );

export const runRepositoryPreparation = async (input: {
  readonly prepare: { readonly command: string; readonly timeoutSeconds: number };
  readonly exec: RepositoryPreparationExecutor;
  readonly cwd?: string;
}): Promise<RepositoryPreparationResult> => ({
  command: input.prepare.command,
  ...(await runValidationCommand({
    command: input.prepare.command,
    timeoutSeconds: input.prepare.timeoutSeconds,
    completionMarker: "__BUTWHY_PREPARE_COMPLETED_prepare__",
    missingTimeoutMessage: "Could not find timeout command for prepare.",
    exec: input.exec,
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
  })),
});
