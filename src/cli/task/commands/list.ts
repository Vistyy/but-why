import type { CliResult } from "../../../cliResults.js";
import { stateStoreUnavailable, success, usageError } from "../../../cliResults.js";
import { withGlobalHelpFlags } from "../../../cliHelp.js";
import { loadChangeInspection } from "../../../localChange/loadChangeInspection.js";
import type { StructuredValue } from "../../../output/structured.js";
import { isTaskState, taskStates, type TaskState } from "../../../task/lifecycle.js";
import type { TaskSummary } from "../../../task/task.js";
import { loadTasks, type TaskCommandEnvironment } from "../taskCliSupport.js";

export const runListCommand = (
  args: readonly string[],
  environment: TaskCommandEnvironment,
): CliResult => {
  if (args.length === 1 && args[0] === "--help") {
    return success({
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
      examples: ["by task list", "by task list --all", "by task list --state needs_input"],
    });
  }

  const parseResult = parseTaskListArgs(args);

  if (!parseResult.ok) {
    return parseResult.result;
  }

  const tasksLoad = loadTasks(environment, true);

  if (!tasksLoad.ok) {
    return tasksLoad.result;
  }

  try {
    const tasks = tasksLoad.tasks.listTasks({
      includeDone: parseResult.all || parseResult.state !== undefined,
      ...(parseResult.state === undefined ? {} : { state: parseResult.state }),
    });

    const changeInspection =
      environment.taskUseCases === undefined
        ? loadChangeInspection({
            cwd: environment.cwd,
            migrationTimestamp: () => environment.now().toISOString(),
          })
        : undefined;
    if (changeInspection !== undefined && !changeInspection.ok) {
      return stateStoreUnavailable(tasksLoad.tasks.taskPrefix);
    }

    return success({
      count: tasks.length,
      tasks: taskSummaryRows(
        tasks,
        changeInspection === undefined
          ? () => null
          : changeInspection.inspection.inspectTaskProjection,
      ),
      ...(tasks.length === 0 ? { help: [createTaskHelp] } : {}),
    });
  } catch {
    return stateStoreUnavailable(tasksLoad.tasks.taskPrefix);
  }
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
  changeProjection: (taskId: TaskSummary["id"]) => StructuredValue,
): readonly StructuredValue[] =>
  tasks.map((task) => ({
    id: task.id,
    title: task.title,
    state: task.state,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    startable: task.startable,
    blockedBy: task.blockedBy,
    change: changeProjection(task.id),
  }));

const createTaskHelp =
  'Run `by task create --title "..." --description-file <file>` to create a task.';
