import type { CliResult } from "../../cliResults.js";
import { stateStoreUnavailable, success } from "../../cliResults.js";
import type { StructuredValue } from "../../output/structured.js";
import type { TaskSummary } from "../../task/task.js";
import { loadTasks, type TaskCommandEnvironment } from "./taskCliSupport.js";

export const dashboard = (
  bin: string,
  description: string,
  environment: TaskCommandEnvironment,
): CliResult => {
  const tasksLoad = loadTasks(environment, true);

  if (!tasksLoad.ok) {
    return tasksLoad.result;
  }

  try {
    const tasks = tasksLoad.tasks.listActionableTasks();

    return success({
      bin,
      description,
      count: tasks.length,
      tasks: taskSummaryRows(tasks),
      ...(tasks.length === 0 ? { help: [createTaskHelp] } : {}),
    });
  } catch {
    return stateStoreUnavailable(tasksLoad.tasks.taskPrefix);
  }
};

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
