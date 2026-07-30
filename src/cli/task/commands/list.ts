import { Effect } from "effect";

import type { CliResult } from "../../../cliResults.js";
import { stateStoreUnavailable, success } from "../../../cliResults.js";
import { loadChangeInspection } from "../../../change/loadChangeInspection.js";
import type { StructuredValue } from "../../../output/structured.js";
import type { RepositoryStorageError } from "../../../contracts/repositoryStorageError.js";
import { type TaskState } from "../../../task/lifecycle.js";
import type { TaskSummary } from "../../../task/task.js";
import { withTasks, type TaskCommandEnvironment } from "../taskCliSupport.js";

export type TaskListCommand = {
  readonly all: boolean;
  readonly state: TaskState | undefined;
};

export const runListCommand = (
  command: TaskListCommand,
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> =>
  withTasks(environment, true, (taskUseCases) =>
    Effect.flatMap(
      taskUseCases.listTasks({
        includeDone: command.all || command.state !== undefined,
        ...(command.state === undefined ? {} : { state: command.state }),
      }),
      (tasks) => {
        const changeInspection =
          environment.taskUseCases === undefined
            ? loadChangeInspection({ cwd: environment.cwd })
            : undefined;
        if (changeInspection !== undefined && !changeInspection.ok) {
          return Effect.succeed(stateStoreUnavailable(taskUseCases.taskPrefix));
        }
        return Effect.map(
          taskSummaryRows(
            tasks,
            changeInspection === undefined
              ? () => Effect.succeed(null)
              : changeInspection.inspection.inspectTaskProjection,
          ),
          (rows) =>
            success({
              count: tasks.length,
              tasks: rows,
              ...(tasks.length === 0 ? { help: [createTaskHelp] } : {}),
            }),
        );
      },
    ),
  );

const taskSummaryRows = (
  tasks: readonly TaskSummary[],
  changeProjection: (
    taskId: TaskSummary["id"],
  ) => Effect.Effect<StructuredValue, RepositoryStorageError>,
): Effect.Effect<readonly StructuredValue[], RepositoryStorageError> =>
  Effect.forEach(tasks, (task) =>
    Effect.map(changeProjection(task.id), (change) => ({
      id: task.id,
      title: task.title,
      state: task.state,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      startable: task.startable,
      blockedBy: task.blockedBy,
      change,
    })),
  );

const createTaskHelp =
  'Run `by task create --title "..." --description-file <file>` to create a task.';
