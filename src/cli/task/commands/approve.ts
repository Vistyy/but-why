// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";

import type { CliResult } from "../../../cliResults.js";
import { runtimeError, success } from "../../../cliResults.js";
import { parseCliTaskIdValue } from "../../../cliTaskId.js";
import type { PublicTaskId } from "../../../task/taskId.js";
import {
  resolveTaskId,
  type TaskCommandEnvironment,
  taskNotFound,
  withTasks,
} from "../taskCliSupport.js";
import { taskApprovalStateHelp } from "../taskStateHelp.js";

export type TaskIdCommand = { readonly taskId: string };

export const runApproveCommand = (
  command: TaskIdCommand,
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  const parsed = parseCliTaskIdValue(command.taskId);
  if (!parsed.ok) return Effect.succeed(parsed.result);
  return withTasks(environment, false, (tasks) => {
    const taskId = resolveTaskId(tasks, parsed.taskId);
    if (!taskId.ok) return Effect.succeed(taskId.result);
    return Effect.map(
      tasks.approveTask(taskId.taskId, environment.now().toISOString()),
      (result) => {
        if (!result.ok) {
          if (result.code === "task_not_found") return taskNotFound(taskId.taskId);
          if (result.code === "task_review_active") {
            return runtimeError({
              code: "task_review_active",
              message: `Cannot approve task ${taskId.taskId} while its Task Review is active.`,
              details: { taskId: taskId.taskId },
              help: [`Inspect the active Review with \`by task show ${taskId.taskId}\`.`],
            });
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
