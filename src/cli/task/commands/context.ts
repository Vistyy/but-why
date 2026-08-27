// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";

import type { CliResult } from "../../../cliResults.js";
import { success } from "../../../cliResults.js";
import { parseCliTaskIdValue, taskIdResolutionError } from "../../../cliTaskId.js";
import { getTaskContext } from "../../../task/composition/taskContext.js";
import {
  type TaskCommandEnvironment,
  type TaskIdCommand,
  taskNotFound,
  withTasks,
} from "../taskCliSupport.js";

export const runContextCommand = (
  command: TaskIdCommand,
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  const parsed = parseCliTaskIdValue(command.taskId);
  if (!parsed.ok) return Effect.succeed(parsed.result);
  return withTasks(environment, (cwd) =>
    Effect.map(getTaskContext(cwd, parsed.taskId), (result) => {
      if (result !== undefined && "error" in result) {
        return taskIdResolutionError(result.error);
      }
      return result === undefined ? taskNotFound(parsed.taskId) : success({ task: result });
    }),
  );
};
