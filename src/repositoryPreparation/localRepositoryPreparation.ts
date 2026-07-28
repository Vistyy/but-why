import { executeHostCommand } from "../command/hostCommand.js";
import type { RepositoryPreparationExecutor } from "./runRepositoryPreparation.js";

export const executeLocalRepositoryPreparation: RepositoryPreparationExecutor = (
  command,
  options,
) =>
  executeHostCommand({
    command: "sh",
    args: ["-c", command],
    ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
  });
