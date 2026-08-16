import { Effect } from "effect";

import type { CliResult } from "../../../cliResults.js";
import { stateStoreUnavailable, success } from "../../../cliResults.js";
import { parseCliTaskIdValue } from "../../../cliTaskId.js";
import { loadTaskContextInspection } from "../../../taskChange/composition/loadTaskContextInspection.js";
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
  return withTasks(environment, (tasks) => {
    const taskId = resolveTaskId(tasks, parsed.taskId);
    if (!taskId.ok) return Effect.succeed(taskId.result);
    const contextInspection =
      environment.taskContextInspectionUseCases === undefined &&
      environment.taskUseCases === undefined
        ? loadTaskContextInspection({ cwd: environment.cwd })
        : undefined;
    if (contextInspection !== undefined && !contextInspection.ok) {
      return Effect.succeed(stateStoreUnavailable(tasks.taskPrefix));
    }
    const getTaskContext =
      environment.taskContextInspectionUseCases?.getTaskContextById ??
      contextInspection?.operation.getTaskContextById ??
      tasks.getTaskContextById;
    return Effect.map(getTaskContext(taskId.taskId), (task) =>
      task === undefined ? taskNotFound(taskId.taskId) : success({ task }),
    );
  });
};
