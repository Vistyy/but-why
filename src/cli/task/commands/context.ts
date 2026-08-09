// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";

import type { CliResult } from "../../../cliResults.js";
import { success } from "../../../cliResults.js";
import { parseCliTaskIdValue } from "../../../cliTaskId.js";
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
  return withTasks(environment, false, (tasks) => {
    const taskId = resolveTaskId(tasks, parsed.taskId);
    if (!taskId.ok) return Effect.succeed(taskId.result);
    return Effect.map(tasks.getTaskContextById(taskId.taskId), (task) =>
      task === undefined ? taskNotFound(taskId.taskId) : success({ task }),
    );
  });
};
