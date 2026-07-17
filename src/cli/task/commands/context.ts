import type { CliResult } from "../../../cliResults.js";
import { stateStoreUnavailable, success } from "../../../cliResults.js";
import { withGlobalHelpFlags } from "../../../cliHelp.js";
import { runContextApplyCommand } from "./contextApply.js";
import { runContextDraftCommand } from "./contextDraft.js";
import { resolveTaskIdArg, taskNotFound, type TaskCommandEnvironment } from "../taskCliSupport.js";

export const runContextCommand = (
  args: readonly string[],
  environment: TaskCommandEnvironment,
): CliResult => {
  if (args[0] === "draft") {
    return runContextDraftCommand(args.slice(1), environment);
  }

  if (args[0] === "apply") {
    return runContextApplyCommand(args.slice(1), environment);
  }

  if (args.length === 1 && args[0] === "--help") {
    return success({
      usage: "by task context <task-id> | <command> <task-id>",
      commands: [
        {
          command: "by task context draft <task-id>",
          description: "Create an editable Task Context draft",
        },
        {
          command: "by task context apply <task-id>",
          description: "Apply an editable Task Context draft",
        },
      ],
      flags: withGlobalHelpFlags(),
      examples: [
        "by task context BY-1",
        "by task context draft BY-1",
        "by task context apply BY-1",
      ],
    });
  }

  const taskId = resolveTaskIdArg(args, environment, "by task context <task-id>");

  if (!taskId.ok) {
    return taskId.result;
  }

  try {
    const task = taskId.tasks.getTaskContextById(taskId.taskId);

    if (task === undefined) {
      return taskNotFound(taskId.taskId);
    }

    return success({ task });
  } catch {
    return stateStoreUnavailable(taskId.tasks.taskPrefix);
  }
};
