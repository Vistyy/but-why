import { Effect } from "effect";

import type { CliResult } from "../../../cliResults.js";
import { success } from "../../../cliResults.js";
import { withGlobalHelpFlags } from "../../../cliHelp.js";
import { runContextApplyCommand } from "./contextApply.js";
import { runContextDraftCommand } from "./contextDraft.js";
import {
  parseTaskIdArg,
  resolveTaskId,
  taskNotFound,
  withTasks,
  type TaskCommandEnvironment,
} from "../taskCliSupport.js";

export const runContextCommand = (
  args: readonly string[],
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  if (args[0] === "draft") return runContextDraftCommand(args.slice(1), environment);
  if (args[0] === "apply") return runContextApplyCommand(args.slice(1), environment);
  if (args.length === 1 && args[0] === "--help") {
    return Effect.succeed(
      success({
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
      }),
    );
  }

  const parsed = parseTaskIdArg(args, "by task context <task-id>");
  if (!parsed.ok) return Effect.succeed(parsed.result);
  return withTasks(environment, false, (tasks) => {
    const taskId = resolveTaskId(tasks, parsed.taskId);
    if (!taskId.ok) return Effect.succeed(taskId.result);
    return Effect.map(tasks.getTaskContextById(taskId.taskId), (task) =>
      task === undefined ? taskNotFound(taskId.taskId) : success({ task }),
    );
  });
};
