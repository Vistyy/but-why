import type { CliResult } from "../../../cliResults.js";
import { runtimeError, stateStoreUnavailable, success } from "../../../cliResults.js";
import { withGlobalHelpFlags } from "../../../cliHelp.js";
import type { StartIneligibleState } from "../../../task/startPolicy.js";
import type { PublicTaskId } from "../../../task/taskId.js";
import { resolveTaskIdArg, taskNotFound, type TaskCommandEnvironment } from "../taskCliSupport.js";

export const runStartCommand = (
  args: readonly string[],
  environment: TaskCommandEnvironment,
): CliResult => {
  if (args.length === 1 && args[0] === "--help") {
    return success({
      usage: "by task start <task-id>",
      arguments: [
        {
          argument: "<task-id>",
          description: "Public Task ID, such as BY-1",
        },
      ],
      flags: withGlobalHelpFlags(),
      examples: ["by task start BY-1"],
    });
  }

  const taskId = resolveTaskIdArg(args, environment, "by task start <task-id>");

  if (!taskId.ok) {
    return taskId.result;
  }

  try {
    const result = taskId.tasks.startTask(taskId.taskId, environment.now().toISOString());

    if (!result.ok) {
      if (result.code === "task_not_found") {
        return taskNotFound(taskId.taskId);
      }

      return invalidTaskStart(taskId.taskId, result.state);
    }

    return success({
      task: {
        id: result.task.id,
        state: result.task.state,
        changed: result.changed,
        updatedAt: result.task.updatedAt,
      },
      next: startTaskNextAction(result.task.id),
    });
  } catch {
    return stateStoreUnavailable(taskId.tasks.taskPrefix);
  }
};

const invalidTaskStart = (taskId: PublicTaskId, state: StartIneligibleState): CliResult =>
  runtimeError({
    code: "invalid_task_state",
    message: `Cannot start task ${taskId} from state ${state}`,
    details: { taskId, state },
    help: [invalidTaskStartHelp(taskId, state)],
  });

const invalidTaskStartHelpByState = {
  new: (taskId: PublicTaskId) => `Approve the Task first with by task approve ${taskId}.`,
  validating: () => "Wait for validation to finish.",
  needs_input: (taskId: PublicTaskId) =>
    `Address findings or add Task Context, then run by submit ${taskId}.`,
  ready: () => "Review and merge the pull request.",
  done: () => "Task is already done.",
} satisfies Record<StartIneligibleState, (taskId: PublicTaskId) => string>;

const invalidTaskStartHelp = (taskId: PublicTaskId, state: StartIneligibleState): string =>
  invalidTaskStartHelpByState[state](taskId);

const startTaskNextAction = (taskId: string): string =>
  `Implement the task, then run by submit ${taskId}`;
