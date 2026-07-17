import type { CliResult } from "../../../cliResults.js";
import { runtimeError, stateStoreUnavailable, success } from "../../../cliResults.js";
import { withGlobalHelpFlags } from "../../../cliHelp.js";
import type { PublicTaskId } from "../../../task/taskId.js";
import { taskApprovalStateHelp } from "../taskStateHelp.js";
import { resolveTaskIdArg, taskNotFound, type TaskCommandEnvironment } from "../taskCliSupport.js";

export const runApproveCommand = (
  args: readonly string[],
  environment: TaskCommandEnvironment,
): CliResult => {
  if (args.length === 1 && args[0] === "--help") {
    return success({
      usage: "by task approve <task-id>",
      arguments: [
        {
          argument: "<task-id>",
          description: "Public Task ID, such as BY-1",
        },
      ],
      flags: withGlobalHelpFlags(),
      examples: ["by task approve BY-1"],
    });
  }

  const taskId = resolveTaskIdArg(args, environment, "by task approve <task-id>");

  if (!taskId.ok) {
    return taskId.result;
  }

  try {
    const result = taskId.tasks.approveTask(taskId.taskId, environment.now().toISOString());

    if (!result.ok) {
      if (result.code === "task_not_found") {
        return taskNotFound(taskId.taskId);
      }

      return invalidTaskApproval(taskId.taskId, result.state);
    }

    return success({
      task: {
        id: result.task.id,
        state: result.task.state,
        changed: result.changed,
        updatedAt: result.task.updatedAt,
      },
    });
  } catch {
    return stateStoreUnavailable(taskId.tasks.taskPrefix);
  }
};

const invalidTaskApproval = (taskId: PublicTaskId, state: string): CliResult =>
  runtimeError({
    code: "invalid_task_state",
    message: `Cannot approve task ${taskId} from state ${state}`,
    details: { taskId, state },
    help: [taskApprovalStateHelp(taskId, state)],
  });
