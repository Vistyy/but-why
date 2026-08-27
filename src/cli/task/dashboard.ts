// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";

import type { CliResult } from "../../cliResults.js";
import { success } from "../../cliResults.js";
import type { StructuredValue } from "../../output/structured.js";
import { listActionableTasks } from "../../task/composition/listActionableTasks.js";
import type { TaskSummary } from "../../task/task.js";
import { type TaskCommandEnvironment, withTasks } from "./taskCliSupport.js";

export const dashboard = (
  bin: string,
  description: string,
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> =>
  withTasks(environment, (runtime) =>
    Effect.map(listActionableTasks(runtime), (actionable) =>
      success({
        bin,
        description,
        count: actionable.length,
        tasks: taskSummaryRows(actionable),
        ...(actionable.length === 0 ? { help: [createTaskHelp] } : {}),
      }),
    ),
  );

const taskSummaryRows = (tasks: readonly TaskSummary[]): readonly StructuredValue[] =>
  tasks.map((task) => ({
    id: task.id,
    title: task.title,
    state: task.state,
  }));

const createTaskHelp = 'Run `by task create --title "..." --file <path|->` to create a task.';
