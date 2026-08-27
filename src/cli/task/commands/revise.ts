// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import type { CliResult } from "../../../cliResults.js";
import { runtimeError, success } from "../../../cliResults.js";
import { parseCliTaskIdValue } from "../../../cliTaskId.js";
import type { ReviseTaskResult } from "../../../task/taskStore.js";
import { reviseTask } from "../../../taskChange/composition/reviseTask.js";
import {
  resolveTaskId,
  type TaskCommandEnvironment,
  type TaskIdCommand,
  taskMutationView,
  taskNotFound,
  withTasks,
} from "../taskCliSupport.js";

export const runReviseCommand = (
  command: TaskIdCommand,
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  const parsed = parseCliTaskIdValue(command.taskId);
  if (!parsed.ok) return Effect.succeed(parsed.result);
  return withTasks(environment, (context) => {
    const taskId = resolveTaskId(context, parsed.taskId);
    if (!taskId.ok) return Effect.succeed(taskId.result);
    return Effect.map(
      reviseTask(environment.cwd, {
        taskId: taskId.taskId,
        now: environment.now().toISOString(),
      }),
      (result) => reviseResult(taskId.taskId, result),
    );
  });
};

const reviseResult = (taskId: string, result: ReviseTaskResult): CliResult => {
  if (result.ok) {
    return success({
      task: { ...taskMutationView(result.task), changed: result.changed },
      help: [
        result.changed
          ? `Edit Task ${taskId} with \`by task context draft ${taskId}\` and \`by task context apply ${taskId}\`.`
          : `Task ${taskId} is already New and can be edited.`,
      ],
    });
  }
  if (result.code === "task_not_found") return taskNotFound(taskId);
  if (result.code === "task_change_linked") {
    return runtimeError({
      code: result.code,
      message: `Cannot revise Task ${taskId} because it is linked to a Change.`,
      details: { taskId, changeId: result.changeId },
      help: [`Inspect the Change with \`by change show ${result.changeId}\`.`],
    });
  }
  if (result.code === "active_task_review") {
    return runtimeError({
      code: result.code,
      message: `Cannot revise Task ${taskId} while its Task Review is active.`,
      details: { taskId, reviewId: result.reviewId },
      help: [`Inspect the Task Review with \`by task-review show ${result.reviewId}\`.`],
    });
  }
  return runtimeError({
    code: result.code,
    message: `Cannot revise Task ${taskId} from state ${result.state}.`,
    details: { taskId, state: result.state },
    help: ["Only an unlinked Todo or New Task can be revised."],
  });
};
