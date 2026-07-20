import type { CliResult } from "../../cliResults.js";
import { repoStateLoadError, runtimeError } from "../../cliResults.js";
import {
  parseCliTaskIdArg,
  taskIdResolutionError,
  type CliTaskIdParseResult,
} from "../../cliTaskId.js";
import { loadTaskUseCases } from "../../localTask/taskUseCases.js";
import type { PublicTaskId } from "../../task/taskId.js";
import type { TaskUseCases } from "../../task/taskUseCases.js";

export type TaskCommandEnvironment = {
  readonly cwd: string;
  readonly now: () => Date;
  readonly taskUseCases?: TaskUseCases;
};

export type TasksLoadResult =
  | {
      readonly ok: true;
      readonly tasks: TaskUseCases;
    }
  | {
      readonly ok: false;
      readonly result: CliResult;
    };

export const loadTasks = (
  environment: TaskCommandEnvironment,
  requireState: boolean,
): TasksLoadResult => {
  if (environment.taskUseCases !== undefined) {
    return { ok: true, tasks: environment.taskUseCases };
  }

  const result = loadTaskUseCases({
    cwd: environment.cwd,
    requireState,
  });

  if (result.ok) {
    return result;
  }

  return { ok: false, result: repoStateLoadError(result.error) };
};

export type ResolvedTaskIdResult =
  | {
      readonly ok: true;
      readonly tasks: TaskUseCases;
      readonly taskId: PublicTaskId;
    }
  | {
      readonly ok: false;
      readonly result: CliResult;
    };

export const resolveTaskIdArg = (
  args: readonly string[],
  environment: TaskCommandEnvironment,
  usage: string,
): ResolvedTaskIdResult => {
  const taskIdParse = parseTaskIdArg(args, usage);

  if (!taskIdParse.ok) {
    return taskIdParse;
  }

  const tasksLoad = loadTasks(environment, false);

  if (!tasksLoad.ok) {
    return tasksLoad;
  }

  return resolveTaskId(tasksLoad.tasks, taskIdParse.taskId);
};

export const resolveTaskId = (tasks: TaskUseCases, taskId: PublicTaskId): ResolvedTaskIdResult => {
  const resolvedTaskId = tasks.resolveTaskId(taskId);

  if (!resolvedTaskId.ok) {
    return { ok: false, result: taskIdResolutionError(resolvedTaskId) };
  }

  return { ok: true, tasks, taskId: resolvedTaskId.taskId };
};

const parseTaskIdArg = (args: readonly string[], usage: string): CliTaskIdParseResult =>
  parseCliTaskIdArg(args, {
    missingHelp: `Run \`${usage}\`.`,
    extraHelp: `Run \`${usage}\`.`,
  });

export const taskNotFound = (taskId: string): CliResult =>
  runtimeError({
    code: "task_not_found",
    message: `Task was not found: ${taskId}`,
    details: { taskId },
    help: ["Run `by task list --all` to see known Tasks."],
  });
