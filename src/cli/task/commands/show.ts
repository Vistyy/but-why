import type { CliResult } from "../../../cliResults.js";
import { stateStoreUnavailable, success } from "../../../cliResults.js";
import { withGlobalHelpFlags } from "../../../cliHelp.js";
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
    const task = taskId.tasks.getTaskById(taskId.taskId);

    if (task === undefined) {
      return taskNotFound(taskId.taskId);
    }

    return success({
      task: {
        id: task.id,
        title: task.title,
        state: task.state,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        branch: task.branch,
        latestValidationRun: task.latestValidationRun,
        tokenTotals: null,
        commentCount: task.commentCount,
        prerequisites: task.prerequisites,
        dependents: task.dependents,
      },
    });
  } catch {
    return stateStoreUnavailable(taskId.tasks.taskPrefix);
  }
};
