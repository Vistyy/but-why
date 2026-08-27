// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";

import type { CliResult } from "../../../cliResults.js";
import { success } from "../../../cliResults.js";
import { parseCliTaskIdValue } from "../../../cliTaskId.js";
import { getTaskContext } from "../../../task/composition/taskContext.js";
import {
  resolveTaskId,
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
  return withTasks(environment, (runtime) => {
    const taskId = resolveTaskId(runtime, parsed.taskId);
    if (!taskId.ok) return Effect.succeed(taskId.result);
    return Effect.map(getTaskContext(runtime, taskId.taskId), (task) =>
      task === undefined ? taskNotFound(taskId.taskId) : success({ task }),
    );
  });
};
