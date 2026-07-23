import { Effect } from "effect";

import type { CliResult } from "../../../cliResults.js";
import { stateStoreUnavailable, success, usageError } from "../../../cliResults.js";
import { withGlobalHelpFlags } from "../../../cliHelp.js";
import { loadChangeInspection } from "../../../change/loadChangeInspection.js";
import type { StructuredValue } from "../../../output/structured.js";
import type { RepositoryStorageError } from "../../../contracts/repositoryStorageError.js";
import { isTaskState, taskStates, type TaskState } from "../../../task/lifecycle.js";
import type { TaskSummary } from "../../../task/task.js";
import { withTasks, type TaskCommandEnvironment } from "../taskCliSupport.js";

export const runListCommand = (
  args: readonly string[],
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  if (args.length === 1 && args[0] === "--help") {
    return Effect.succeed(
      success({
        usage: "by task list [--all] [--state <state>]",
        flags: withGlobalHelpFlags([
          {
            flag: "--all",
            description: "Include done Tasks",
          },
          {
            flag: "--state <state>",
            description: "Show only Tasks in one state",
          },
        ]),
        examples: ["by task list", "by task list --all", "by task list --state ready"],
      }),
    );
  }

  const parseResult = parseTaskListArgs(args);

  if (!parseResult.ok) return Effect.succeed(parseResult.result);

  return withTasks(environment, true, (taskUseCases) =>
    Effect.flatMap(
      taskUseCases.listTasks({
        includeDone: parseResult.all || parseResult.state !== undefined,
        ...(parseResult.state === undefined ? {} : { state: parseResult.state }),
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
};

type TaskListArgsParseResult =
  | {
      readonly ok: true;
      readonly all: boolean;
      readonly state: TaskState | undefined;
    }
  | {
      readonly ok: false;
      readonly result: CliResult;
    };

const parseTaskListArgs = (args: readonly string[]): TaskListArgsParseResult => {
  let all = false;
  let state: TaskState | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--all") {
      all = true;
      continue;
    }

    if (arg === "--state") {
      const value = args[index + 1];

      if (value === undefined || value.startsWith("-")) {
        return invalidTaskState("");
      }

      if (!isTaskState(value)) {
        return invalidTaskState(value);
      }

      state = value;
      index += 1;
      continue;
    }

    if (arg?.startsWith("-")) {
      return {
        ok: false,
        result: usageError({
          code: "unknown_flag",
          message: `Unknown flag: ${arg}`,
          help: ["Run `by task list --help`."],
        }),
      };
    }

    return {
      ok: false,
      result: usageError({
        code: "unknown_argument",
        message: `Unknown argument: ${arg ?? ""}`,
        help: ["Run `by task list --help`."],
      }),
    };
  }

  return { ok: true, all, state };
};

const invalidTaskState = (state: string): TaskListArgsParseResult => ({
  ok: false,
  result: usageError({
    code: "invalid_task_state",
    message: `Unknown task state ${state}.`,
    details: { state },
    help: [`Use one of: ${taskStates.join(", ")}.`],
  }),
});

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
