import type { CliResult } from "../../../cliResults.js";
import { stateStoreUnavailable, success } from "../../../cliResults.js";
import { withGlobalHelpFlags } from "../../../cliHelp.js";
import {
  taskBriefView,
  validationRunBriefView,
  validationRunFindingView,
} from "../../validationRunViews.js";
import { resolveTaskIdArg, taskNotFound, type TaskCommandEnvironment } from "../taskCliSupport.js";

export const runFindingsCommand = (
  args: readonly string[],
  environment: TaskCommandEnvironment,
): CliResult => {
  if (args.length === 1 && args[0] === "--help") {
    return success({
      usage: "by task findings <task-id>",
      arguments: [
        {
          argument: "<task-id>",
          description: "Public Task ID, such as BY-1",
        },
      ],
      flags: withGlobalHelpFlags(),
      examples: ["by task findings BY-1"],
    });
  }

  const taskId = resolveTaskIdArg(args, environment, "by task findings <task-id>");

  if (!taskId.ok) {
    return taskId.result;
  }

  try {
    const result = taskId.tasks.getLatestTaskValidationFindings(taskId.taskId);

    if (result === undefined) {
      return taskNotFound(taskId.taskId);
    }

    return success({
      task: taskBriefView(result.task),
      validationRun:
        result.validationRun === null ? null : validationRunBriefView(result.validationRun),
      findings: result.findings.map(validationRunFindingView),
      toolingFailures: result.toolingFailures,
      count: result.findings.length,
    });
  } catch {
    return stateStoreUnavailable(taskId.tasks.taskPrefix);
  }
};
