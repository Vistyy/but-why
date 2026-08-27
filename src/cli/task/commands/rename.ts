// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import type { CliResult } from "../../../cliResults.js";
import { runtimeError, success } from "../../../cliResults.js";
import { parseCliTaskIdValue } from "../../../cliTaskId.js";
import type { PublicTaskId } from "../../../task/taskId.js";
import type { RenameTaskResult } from "../../../task/taskStore.js";
import { normalizeTaskTitle } from "../../../task/taskTitle.js";
import { renameTask } from "../../../taskChange/composition/renameTask.js";
import {
  resolveTaskId,
  type TaskCommandEnvironment,
  taskNotFound,
  withTasks,
} from "../taskCliSupport.js";
import { taskTitleInputError } from "../taskTitle.js";

export type TaskRenameCommand = {
  readonly taskId: string;
  readonly title: string;
};

export const runRenameCommand = (
  command: TaskRenameCommand,
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  const title = normalizeTaskTitle(command.title);
  if (!title.ok) return Effect.succeed(taskTitleInputError(title));
  const parsed = parseCliTaskIdValue(command.taskId);
  if (!parsed.ok) return Effect.succeed(parsed.result);
  return withTasks(environment, (cwd) => {
    const taskId = resolveTaskId(cwd, parsed.taskId);
    if (!taskId.ok) return Effect.succeed(taskId.result);
    return Effect.map(renameTask(cwd, { taskId: taskId.taskId, title: title.title }), (result) =>
      renameResult(taskId.taskId, result),
    );
  });
};

const renameResult = (taskId: PublicTaskId, result: RenameTaskResult): CliResult => {
  if (result.ok) {
    return success({
      task: {
        id: result.task.id,
        title: result.task.title,
        state: result.task.state,
        noOp: result.noOp,
      },
    });
  }
  if (result.code === "task_not_found") return taskNotFound(taskId);
  if (result.code === "empty_title" || result.code === "invalid_task_title") {
    return taskTitleInputError(result);
  }
  if (result.code === "task_change_linked") {
    return runtimeError({
      code: result.code,
      message: `Cannot rename Task ${taskId} because it is linked to a Change.`,
      details: { taskId, changeId: result.changeId },
      help: [`Inspect the Change with \`by change show ${result.changeId}\`.`],
    });
  }
  if (result.code === "task_revision_required") {
    return runtimeError({
      code: result.code,
      message: `Cannot rename Task ${taskId} until its approved intent is opened for revision.`,
      details: { taskId, state: result.state },
      help: [`Run \`by task revise ${taskId}\` before changing its title.`],
    });
  }
  if (result.code !== "invalid_task_state") return taskTitleInputError(result);
  return runtimeError({
    code: result.code,
    message: `Cannot rename Task ${taskId} from state ${result.state}.`,
    details: { taskId, state: result.state },
    help: ["Only New Tasks can be renamed."],
  });
};
