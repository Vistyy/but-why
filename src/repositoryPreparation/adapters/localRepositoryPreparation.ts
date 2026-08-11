import { Effect } from "effect";
import { executeHostCommandEffect } from "../../command/hostCommand.js";
import { WorkspaceCommandExecutionFailed } from "../../command/workspaceCommand.js";
import type { RepositoryPreparationEffectExecutor } from "../runRepositoryPreparation.js";

const commandInput = (command: string, cwd: string | undefined) => ({
  command: "sh",
  args: ["-c", command],
  ...(cwd === undefined ? {} : { cwd }),
});

export const executeLocalRepositoryPreparation: RepositoryPreparationEffectExecutor = (
  command,
  options,
) =>
  executeHostCommandEffect(commandInput(command, options?.cwd)).pipe(
    Effect.mapError((error) => new WorkspaceCommandExecutionFailed({ message: error.message })),
  );
