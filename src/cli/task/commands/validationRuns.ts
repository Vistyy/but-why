import type { CliResult } from "../../../cliResults.js";
import { stateStoreUnavailable, success } from "../../../cliResults.js";
import { withGlobalHelpFlags } from "../../../cliHelp.js";
import { validationRunSummaryView } from "../../validationRunViews.js";
import { resolveTaskIdArg, taskNotFound, type TaskCommandEnvironment } from "../taskCliSupport.js";

export const runValidationRunsCommand = (
  args: readonly string[],
  environment: TaskCommandEnvironment,
): CliResult => {
  if (args.length === 1 && args[0] === "--help") {
    return success({
      usage: "by task validation-runs <task-id>",
      arguments: [
        {
          argument: "<task-id>",
          description: "Public Task ID, such as BY-1",
        },
      ],
      flags: withGlobalHelpFlags(),
      examples: ["by task validation-runs BY-1"],
    });
  }

  const taskId = resolveTaskIdArg(args, environment, "by task validation-runs <task-id>");

  if (!taskId.ok) {
    return taskId.result;
  }

  try {
    const result = taskId.tasks.listTaskValidationRuns(taskId.taskId);

    if (result === undefined) {
      return taskNotFound(taskId.taskId);
    }

    return success({
      validationRuns: result.validationRuns.map(validationRunSummaryView),
    });
  } catch {
    return stateStoreUnavailable(taskId.tasks.taskPrefix);
  }
};
