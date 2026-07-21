import { Effect } from "effect";

import type { CliResult } from "../../../cliResults.js";
import { runtimeError, success } from "../../../cliResults.js";
import { withGlobalHelpFlags } from "../../../cliHelp.js";
import type { PublicTaskId } from "../../../task/taskId.js";
import { taskApprovalStateHelp } from "../taskStateHelp.js";
import {
  parseTaskIdArg,
  resolveTaskId,
  taskNotFound,
  withTasks,
  type TaskCommandEnvironment,
} from "../taskCliSupport.js";

export const runApproveCommand = (
  args: readonly string[],
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  if (args.length === 1 && args[0] === "--help") {
    return Effect.succeed(
      success({
        usage: "by task approve <task-id>",
        arguments: [{ argument: "<task-id>", description: "Public Task ID, such as BY-1" }],
        flags: withGlobalHelpFlags(),
        examples: ["by task approve BY-1"],
      }),
    );
  }

  const parsed = parseTaskIdArg(args, "by task approve <task-id>");
  if (!parsed.ok) return Effect.succeed(parsed.result);
  return withTasks(environment, false, (tasks) => {
    const taskId = resolveTaskId(tasks, parsed.taskId);
    if (!taskId.ok) return Effect.succeed(taskId.result);
    return Effect.map(
      tasks.approveTask(taskId.taskId, environment.now().toISOString()),
      (result) => {
        if (!result.ok) {
          return result.code === "task_not_found"
            ? taskNotFound(taskId.taskId)
            : invalidTaskApproval(taskId.taskId, result.state);
        }
        return success({
          task: {
            id: result.task.id,
            state: result.task.state,
            changed: result.changed,
            updatedAt: result.task.updatedAt,
          },
        });
      },
    );
  });
};

const invalidTaskApproval = (taskId: PublicTaskId, state: string): CliResult =>
  runtimeError({
    code: "invalid_task_state",
    message: `Cannot approve task ${taskId} from state ${state}`,
    details: { taskId, state },
    help: [taskApprovalStateHelp(taskId, state)],
  });
