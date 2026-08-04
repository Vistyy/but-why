// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";

import type { CliResult } from "../../../cliResults.js";
import { stateStoreUnavailable, success } from "../../../cliResults.js";
import { loadChangeInspection } from "../../../change/loadChangeInspection.js";
import { parseCliTaskIdValue } from "../../../cliTaskId.js";
import {
  resolveTaskId,
  taskNotFound,
  withTasks,
  type TaskCommandEnvironment,
} from "../taskCliSupport.js";
import type { TaskIdCommand } from "./approve.js";

export const runTaskShowCommand = (
  command: TaskIdCommand,
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  const parsed = parseCliTaskIdValue(command.taskId);
  if (!parsed.ok) return Effect.succeed(parsed.result);
  return withTasks(environment, false, (tasks) => {
    const taskId = resolveTaskId(tasks, parsed.taskId);
    if (!taskId.ok) return Effect.succeed(taskId.result);
    return Effect.gen(function* () {
      const task = yield* tasks.getTaskForInspection(taskId.taskId);
      if (task === undefined) return taskNotFound(taskId.taskId);
      const change =
        environment.taskUseCases === undefined
          ? loadChangeInspection({ cwd: environment.cwd })
          : undefined;
      if (change !== undefined && !change.ok) return stateStoreUnavailable(tasks.taskPrefix);
      const projection =
        change === undefined ? null : yield* change.inspection.inspectTaskProjection(taskId.taskId);
      return success({
        task: {
          id: task.id,
          title: task.title,
          state: task.state,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          commentCount: task.commentCount,
          ...(task.cancelReason === null ? {} : { cancelReason: task.cancelReason }),
          prerequisites: task.prerequisites,
          dependents: task.dependents,
          change: projection,
        },
        contextCommand: `by task context ${task.id}`,
      });
    });
  });
};
