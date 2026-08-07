// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import { loadChangeInspection } from "../../../change/loadChangeInspection.js";
import type { CliResult } from "../../../cliResults.js";
import { stateStoreUnavailable, success, usageError } from "../../../cliResults.js";
import type { RepositoryStorageError } from "../../../contracts/repositoryStorageError.js";
import type { StructuredValue } from "../../../output/structured.js";
import type { TaskState } from "../../../task/lifecycle.js";
import type { TaskSummary } from "../../../task/task.js";
import type { TaskListLimit } from "../../../task/taskStore.js";
import { type TaskCommandEnvironment, withTasks } from "../taskCliSupport.js";

export type TaskListCommand = {
  readonly all: boolean;
  readonly state: TaskState | undefined;
  readonly limit: string;
};

export const defaultTaskListLimit = 5;

export const runListCommand = (
  command: TaskListCommand,
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  const limit = parseTaskListLimit(command.limit);
  if (!limit.ok) return Effect.succeed(limit.result);

  return withTasks(environment, true, (taskUseCases) =>
    Effect.flatMap(
      taskUseCases.listTasks({
        includeDone: command.all || command.state !== undefined,
        ...(command.state === undefined ? {} : { state: command.state }),
        limit: limit.value,
      }),
      (result) => {
        const changeInspection =
          environment.taskUseCases === undefined
            ? loadChangeInspection({ cwd: environment.cwd })
            : undefined;
        if (changeInspection !== undefined && !changeInspection.ok) {
          return Effect.succeed(stateStoreUnavailable(taskUseCases.taskPrefix));
        }
        return Effect.map(
          taskSummaryRows(
            result.tasks,
            changeInspection === undefined
              ? () => Effect.succeed(null)
              : changeInspection.inspection.inspectTaskProjection,
          ),
          (rows) =>
            success({
              count: result.tasks.length,
              total: result.total,
              tasks: rows,
              ...(result.tasks.length === 0
                ? { help: [createTaskHelp] }
                : result.tasks.length < result.total
                  ? { help: [listMoreTasksHelp(command)] }
                  : {}),
            }),
        );
      },
    ),
  );
};

const parseTaskListLimit = (
  value: string,
):
  | { readonly ok: true; readonly value: TaskListLimit }
  | { readonly ok: false; readonly result: CliResult } => {
  if (value === "all") return { ok: true, value };
  if (!/^[1-9][0-9]*$/u.test(value)) return invalidTaskListLimit(value);
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? { ok: true, value: parsed }
    : invalidTaskListLimit(value);
};

const invalidTaskListLimit = (value: string) => ({
  ok: false as const,
  result: usageError({
    code: "invalid_task_list_limit",
    message: "Task list limit must be a positive integer or `all`.",
    details: { limit: value },
    help: ["Run `by task list --limit 5` or `by task list --limit all`."],
  }),
});

const listMoreTasksHelp = (command: TaskListCommand): string => {
  const filters = [
    command.all && command.state === undefined ? "--all" : undefined,
    command.state === undefined ? undefined : `--state ${command.state}`,
  ].filter((filter): filter is string => filter !== undefined);
  return `Run \`by task list ${[...filters, "--limit all"].join(" ")}\` to retrieve all matching Tasks.`;
};

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
      blockedBy: task.blockedBy,
      change,
    })),
  );

const createTaskHelp = 'Run `by task create --title "..." --file <path|->` to create a task.';
