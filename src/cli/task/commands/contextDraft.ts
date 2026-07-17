import type { CliResult } from "../../../cliResults.js";
import { stateStoreUnavailable, success } from "../../../cliResults.js";
import { withGlobalHelpFlags } from "../../../cliHelp.js";
import { resolveTaskIdArg, taskNotFound, type TaskCommandEnvironment } from "../taskCliSupport.js";

export const runContextDraftCommand = (
  args: readonly string[],
  environment: TaskCommandEnvironment,
): CliResult => {
  if (args.length === 1 && args[0] === "--help") {
    return success({
      usage: "by task context draft <task-id>",
      arguments: [
        {
          argument: "<task-id>",
          description: "Public Task ID, such as BY-1",
        },
      ],
      flags: withGlobalHelpFlags(),
      examples: ["by task context draft BY-1"],
    });
  }

  const taskId = resolveTaskIdArg(args, environment, "by task context draft <task-id>");

  if (!taskId.ok) {
    return taskId.result;
  }

  try {
    const draft = taskId.tasks.createTaskContextDraft(taskId.taskId);

    if (draft === undefined) {
      return taskNotFound(taskId.taskId);
    }

    return success({ draft });
  } catch {
    return stateStoreUnavailable(taskId.tasks.taskPrefix);
  }
};
