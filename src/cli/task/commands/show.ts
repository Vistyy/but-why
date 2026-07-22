import { Effect } from "effect";

import type { CliResult } from "../../../cliResults.js";
import { stateStoreUnavailable, success } from "../../../cliResults.js";
import { withGlobalHelpFlags } from "../../../cliHelp.js";
import { loadChangeInspection } from "../../../localChange/loadChangeInspection.js";
import {
  parseTaskIdArg,
  resolveTaskId,
  taskNotFound,
  withTasks,
  type TaskCommandEnvironment,
} from "../taskCliSupport.js";

export const runShowCommand = (
  args: readonly string[],
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  if (args.length === 1 && args[0] === "--help") {
    return Effect.succeed(
      success({
        usage: "by task show <task-id>",
        arguments: [{ argument: "<task-id>", description: "Public Task ID, such as BY-1" }],
        flags: withGlobalHelpFlags(),
        examples: ["by task show BY-1"],
      }),
    );
  }

  const parsed = parseTaskIdArg(args, "by task show <task-id>");
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
          description: task.description,
          state: task.state,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          commentCount: task.commentCount,
          prerequisites: task.prerequisites,
          dependents: task.dependents,
          change: projection,
        },
      });
    });
  });
};
