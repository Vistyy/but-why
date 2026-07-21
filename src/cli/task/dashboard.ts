import { Effect } from "effect";

import type { CliResult } from "../../cliResults.js";
import { success } from "../../cliResults.js";
import type { StructuredValue } from "../../output/structured.js";
import type { TaskSummary } from "../../task/task.js";
import { withTasks, type TaskCommandEnvironment } from "./taskCliSupport.js";

export const dashboard = (
  bin: string,
  description: string,
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> =>
  withTasks(environment, true, (tasks) =>
    Effect.map(tasks.listActionableTasks(), (actionable) =>
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
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }));

const createTaskHelp =
  'Run `by task create --title "..." --description-file <file>` to create a task.';
