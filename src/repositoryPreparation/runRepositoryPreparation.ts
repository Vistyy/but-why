import { Data, Effect } from "effect";
import { runTimedCommand } from "../command/runTimedCommand.js";
import type { WorkspaceCommandExecutor } from "../command/workspaceCommand.js";

export type RepositoryPreparationEffectExecutor = WorkspaceCommandExecutor;

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
  runTimedCommand({
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
