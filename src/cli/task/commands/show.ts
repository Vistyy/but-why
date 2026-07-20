import type { CliResult } from "../../../cliResults.js";
import { stateStoreUnavailable, success } from "../../../cliResults.js";
import { withGlobalHelpFlags } from "../../../cliHelp.js";
import { loadChangeInspection } from "../../../localChange/loadChangeInspection.js";
import { resolveTaskIdArg, taskNotFound, type TaskCommandEnvironment } from "../taskCliSupport.js";

export const runShowCommand = (
  args: readonly string[],
  environment: TaskCommandEnvironment,
): CliResult => {
  if (args.length === 1 && args[0] === "--help") {
    return success({
      usage: "by task show <task-id>",
      arguments: [
        {
          argument: "<task-id>",
          description: "Public Task ID, such as BY-1",
        },
      ],
      flags: withGlobalHelpFlags(),
      examples: ["by task show BY-1"],
    });
  }

  const taskId = resolveTaskIdArg(args, environment, "by task show <task-id>");

  if (!taskId.ok) {
    return taskId.result;
  }

  try {
    const task = taskId.tasks.getTaskForInspection(taskId.taskId);

    if (task === undefined) {
      return taskNotFound(taskId.taskId);
    }

    const change =
      environment.taskUseCases === undefined
        ? loadChangeInspection({
            cwd: environment.cwd,
            migrationTimestamp: () => environment.now().toISOString(),
          })
        : undefined;
    if (change !== undefined && !change.ok) return stateStoreUnavailable(taskId.tasks.taskPrefix);

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
        change:
          change === undefined ? null : change.inspection.inspectTaskProjection(taskId.taskId),
      },
    });
  } catch {
    return stateStoreUnavailable(taskId.tasks.taskPrefix);
  }
};
