import { Effect } from "effect";

import type { CliResult } from "../../../cliResults.js";
import { success } from "../../../cliResults.js";
import { parseCliTaskIdValue } from "../../../cliTaskId.js";
import {
  resolveTaskId,
  type TaskCommandEnvironment,
  taskNotFound,
  withTasks,
} from "../taskCliSupport.js";

export const runContextDraftCommand = (
  command: { readonly taskId: string },
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  const parsed = parseCliTaskIdValue(command.taskId);
  if (!parsed.ok) return Effect.succeed(parsed.result);
  return withTasks(environment, (tasks) => {
    const taskId = resolveTaskId(tasks, parsed.taskId);
    if (!taskId.ok) return Effect.succeed(taskId.result);
    return Effect.map(tasks.createTaskContextDraft(taskId.taskId), (draft) =>
      draft === undefined ? taskNotFound(taskId.taskId) : success({ draft }),
    );
  });
};
