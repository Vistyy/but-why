import {
  runValidationCommand,
  type ValidationCommandExecutor,
} from "../validation/runValidationCommand.js";

export type RepositoryPreparationExecutor = ValidationCommandExecutor;

export type RepositoryPreparationResult = {
  readonly command: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
};

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
