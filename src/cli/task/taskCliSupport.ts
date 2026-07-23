import { Effect } from "effect";

import type { CliResult } from "../../cliResults.js";
import {
  repoStateLoadError,
  repositoryStorageErrorResult,
  runtimeError,
} from "../../cliResults.js";
import {
  parseCliTaskIdArg,
  taskIdResolutionError,
  type CliTaskIdParseResult,
} from "../../cliTaskId.js";
import { loadRepoLocalContext } from "../../init/repoContext.js";
import { withTaskUseCases } from "../../task/loadTaskUseCases.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { PublicTaskId } from "../../task/taskId.js";
import type { TaskUseCases } from "../../task/taskUseCases.js";
import type { CancellationUseCases } from "../../change/cancelChange.js";

export type TaskCommandEnvironment = {
  readonly cwd: string;
  readonly now: () => Date;
  readonly taskUseCases?: TaskUseCases;
  readonly cancellationUseCases?: CancellationUseCases;
};

export const withTasks = (
  environment: TaskCommandEnvironment,
  requireState: boolean,
  use: (tasks: TaskUseCases) => Effect.Effect<CliResult, RepositoryStorageError>,
): Effect.Effect<CliResult> => {
  const program =
    environment.taskUseCases === undefined
      ? withTaskUseCases({ cwd: environment.cwd, requireState }, use).pipe(
          Effect.map((result) => (result.ok ? result.value : repoStateLoadError(result.error))),
        )
      : use(environment.taskUseCases);

  return program.pipe(
    Effect.catchAll((error) => {
      const context = loadRepoLocalContext(environment.cwd);
      const taskPrefix = context.ok ? context.context.taskPrefix : undefined;
      return Effect.succeed(repositoryStorageErrorResult(error, taskPrefix));
    }),
  );
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

export const resolveTaskId = (tasks: TaskUseCases, taskId: PublicTaskId): ResolvedTaskIdResult => {
  const resolvedTaskId = tasks.resolveTaskId(taskId);
  if (!resolvedTaskId.ok) {
    return { ok: false, result: taskIdResolutionError(resolvedTaskId) };
  }
  return { ok: true, tasks, taskId: resolvedTaskId.taskId };
};

export const parseTaskIdArg = (args: readonly string[], usage: string): CliTaskIdParseResult =>
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
