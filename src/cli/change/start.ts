// fallow-ignore-file duplicate-export -- dynamically loaded command owner
// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import type { CliResult } from "../../cliResults.js";
import type { ChangeCommandEnvironment } from "./changeTypes.js";
import { parseCliTaskIdValue } from "../../cliTaskId.js";
import * as support from "./changeSupport.js";
import { startResult } from "./lifecycleResults.js";

type ChangeStartCommand = {
  readonly taskId: string | undefined;
  readonly baseBranch: string | undefined;
};

export const runStart = (
  command: ChangeStartCommand,
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  const parsedTaskId =
    command.taskId === undefined ? undefined : parseCliTaskIdValue(command.taskId);
  if (parsedTaskId !== undefined && !parsedTaskId.ok) return Effect.succeed(parsedTaskId.result);

  return support.withChanges(environment, (changes) =>
    Effect.map(
      changes.start({
        ...(parsedTaskId === undefined ? {} : { taskId: parsedTaskId.taskId }),
        ...(command.baseBranch === undefined ? {} : { baseBranch: command.baseBranch }),
        now: environment.now().toISOString(),
      }),
      startResult,
    ),
  );
};
