import { Effect } from "effect";

import type { CliResult } from "../../../cliResults.js";
import { runtimeError, success } from "../../../cliResults.js";
import { parseCliTaskIdValue } from "../../../cliTaskId.js";
import type { PublicTaskId } from "../../../task/taskId.js";
import type { RepoReplaceTaskDependenciesResult } from "../../../task/taskUseCases.js";
import {
  resolveTaskId,
  withTasks,
  taskNotFound,
  type TaskCommandEnvironment,
} from "../taskCliSupport.js";

export type TaskDependenciesSetCommand = {
  readonly taskId: string;
  readonly dependsOn: readonly string[];
};

export const runDependenciesCommand = (
  command: TaskDependenciesSetCommand,
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  const parsedDependent = parseCliTaskIdValue(command.taskId);
  if (!parsedDependent.ok) return Effect.succeed(parsedDependent.result);

  return withTasks(environment, false, (tasks) => {
    const dependent = resolveTaskId(tasks, parsedDependent.taskId);
    if (!dependent.ok) return Effect.succeed(dependent.result);
    const prerequisiteTaskIds: PublicTaskId[] = [];
    for (const value of command.dependsOn) {
      const parsedPrerequisite = parseCliTaskIdValue(value);
      if (!parsedPrerequisite.ok) return Effect.succeed(parsedPrerequisite.result);
      const prerequisite = resolveTaskId(tasks, parsedPrerequisite.taskId);
      if (!prerequisite.ok) return Effect.succeed(prerequisite.result);
      prerequisiteTaskIds.push(prerequisite.taskId);
    }
    return Effect.map(
      tasks.replaceTaskDependencies(dependent.taskId, prerequisiteTaskIds),
      (result) =>
        result.ok
          ? success({ task: { id: result.task.id, prerequisites: result.task.prerequisites } })
          : replaceError(dependent.taskId, result),
    );
  });
};

const replaceError = (
  taskId: PublicTaskId,
  result: Exclude<RepoReplaceTaskDependenciesResult, { readonly ok: true }>,
): CliResult => {
  if (result.code === "task_not_found") return taskNotFound(taskId);

  const details = {
    taskId,
    ...(result.code === "dependencies_locked" ? { state: result.state } : {}),
    ...(result.code !== "dependencies_locked" && result.taskId !== undefined
      ? { dependencyTaskId: result.taskId }
      : {}),
  };

  return runtimeError({
    code: result.code,
    message: replaceErrorMessage(taskId, result),
    details,
    help: [
      result.code === "dependencies_locked"
        ? "Dependency edits are available only before Change Start."
        : "Use existing Tasks and keep the direct dependency graph acyclic.",
    ],
  });
};

const replaceErrorMessage = (
  taskId: PublicTaskId,
  result: Exclude<RepoReplaceTaskDependenciesResult, { readonly ok: true }>,
): string => {
  switch (result.code) {
    case "task_not_found":
      return `Task was not found: ${taskId}`;
    case "dependency_unknown_task":
      return `Dependency Task was not found: ${result.taskId ?? ""}`;
    case "dependency_self":
      return `Task ${taskId} cannot depend on itself.`;
    case "dependency_duplicate":
      return `Dependency was provided more than once: ${result.taskId ?? ""}`;
    case "dependency_cycle":
      return "Task dependencies must not contain a cycle.";
    case "dependencies_locked":
      return `Dependencies for task ${taskId} are locked after Start.`;
  }
};
