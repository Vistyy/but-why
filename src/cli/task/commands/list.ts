// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import type { CliResult } from "../../../cliResults.js";
import { success, usageError } from "../../../cliResults.js";
import { listTasks } from "../../../task/composition/listTasks.js";
import type { TaskState } from "../../../task/lifecycle.js";
import type { TaskListLimit } from "../../../task/taskStore.js";
import { listTaskChangeProjections } from "../../../taskChange/composition/loadTaskChangeInspection.js";
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

  return withTasks(environment, (cwd) =>
    Effect.flatMap(
      listTasks(cwd, {
        includeDone: command.all || command.state !== undefined,
        ...(command.state === undefined ? {} : { state: command.state }),
        limit: limit.value,
      }),
      (result) =>
        Effect.map(
          listTaskChangeProjections(
            cwd,
            result.tasks.map((task) => task.id),
          ),
          (projections) =>
            success({
              count: result.tasks.length,
              total: result.total,
              tasks: result.tasks.map((task) => ({
                id: task.id,
                title: task.title,
                state: task.state,
                blockedBy: task.blockedBy,
                change: projections.get(task.id) ?? null,
              })),
              ...(result.tasks.length === 0
                ? { help: [createTaskHelp] }
                : result.tasks.length < result.total
                  ? { help: [listMoreTasksHelp(command)] }
                  : {}),
            }),
        ),
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

const createTaskHelp = 'Run `by task create --title "..." --file <path|->` to create a task.';
