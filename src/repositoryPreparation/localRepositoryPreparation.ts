import { executeHostCommand, executeHostCommandEffect } from "../command/hostCommand.js";
import type { RepositoryPreparationEffectExecutor } from "./runRepositoryPreparation.js";

const commandInput = (command: string, cwd: string | undefined) => ({
  command: "sh",
  args: ["-c", command],
  ...(cwd === undefined ? {} : { cwd }),
});

export const executeLocalRepositoryPreparation: RepositoryPreparationEffectExecutor = Object.assign(
  (command: string, options?: { readonly cwd?: string }) =>
    executeHostCommand(commandInput(command, options?.cwd)),
  {
    effect: (command: string, options?: { readonly cwd?: string }) =>
      executeHostCommandEffect(commandInput(command, options?.cwd)),
  },
);
