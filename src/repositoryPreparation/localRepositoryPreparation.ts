import { Effect } from "effect";
import { ValidationCommandExecutionFailed } from "../change/validation/runValidationCommand.js";
import { executeHostCommandEffect } from "../command/hostCommand.js";
import type { RepositoryPreparationEffectExecutor } from "./runRepositoryPreparation.js";

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
    Effect.mapError((error) => new ValidationCommandExecutionFailed({ message: error.message })),
  );
