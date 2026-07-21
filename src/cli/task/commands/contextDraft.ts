import { Effect } from "effect";

import type { CliResult } from "../../../cliResults.js";
import { success } from "../../../cliResults.js";
import { withGlobalHelpFlags } from "../../../cliHelp.js";
import {
  parseTaskIdArg,
  resolveTaskId,
  taskNotFound,
  withTasks,
  type TaskCommandEnvironment,
} from "../taskCliSupport.js";

export const runContextDraftCommand = (
  args: readonly string[],
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  if (args.length === 1 && args[0] === "--help") {
    return Effect.succeed(
      success({
        usage: "by task context draft <task-id>",
        arguments: [{ argument: "<task-id>", description: "Public Task ID, such as BY-1" }],
        flags: withGlobalHelpFlags(),
        examples: ["by task context draft BY-1"],
      }),
    );
  }
  const parsed = parseTaskIdArg(args, "by task context draft <task-id>");
  if (!parsed.ok) return Effect.succeed(parsed.result);
  return withTasks(environment, false, (tasks) => {
    const taskId = resolveTaskId(tasks, parsed.taskId);
    if (!taskId.ok) return Effect.succeed(taskId.result);
    return Effect.map(tasks.createTaskContextDraft(taskId.taskId), (draft) =>
      draft === undefined ? taskNotFound(taskId.taskId) : success({ draft }),
    );
  });
};
