// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";

import type { CliResult } from "../../../cliResults.js";
import { runtimeError, success } from "../../../cliResults.js";
import { parseCliTaskIdValue } from "../../../cliTaskId.js";
import type { PublicTaskId } from "../../../task/taskId.js";
import type {
  EditTaskDependenciesResult,
  TaskDependencyOperation,
} from "../../../task/taskStore.js";
import { editTaskDependencies } from "../../../taskChange/composition/editTaskDependencies.js";
import { dependencyOptionRequiredError } from "../dependencyOptionUsage.js";
import {
  resolveTaskId,
  type TaskCommandEnvironment,
  taskNotFound,
  withTasks,
} from "../taskCliSupport.js";

export type TaskDependenciesCommand = {
  readonly operation: TaskDependencyOperation;
  readonly taskId: string;
  readonly dependsOn: readonly string[];
};

export const runDependenciesCommand = (
  command: TaskDependenciesCommand,
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  if (command.operation === "replace" && command.dependsOn.length === 0) {
    return Effect.succeed(dependencyOptionRequiredError("replace"));
  }
  if (
    (command.operation === "add" || command.operation === "remove") &&
    command.dependsOn.length === 0
  ) {
    return Effect.succeed(dependencyOptionRequiredError(command.operation));
  }

  const parsedDependent = parseCliTaskIdValue(command.taskId);
  if (!parsedDependent.ok) return Effect.succeed(parsedDependent.result);

  return withTasks(environment, (runtime) => {
    const dependent = resolveTaskId(runtime, parsedDependent.taskId);
    if (!dependent.ok) return Effect.succeed(dependent.result);
    const prerequisiteTaskIds: PublicTaskId[] = [];
    for (const value of command.dependsOn) {
      const parsedPrerequisite = parseCliTaskIdValue(value);
      if (!parsedPrerequisite.ok) return Effect.succeed(parsedPrerequisite.result);
      const prerequisite = resolveTaskId(runtime, parsedPrerequisite.taskId);
      if (!prerequisite.ok) return Effect.succeed(prerequisite.result);
      prerequisiteTaskIds.push(prerequisite.taskId);
    }
    return Effect.map(
      editTaskDependencies(runtime, {
        taskId: dependent.taskId,
        operation: command.operation,
        prerequisiteTaskIds,
      }),
      (result) =>
        result.ok
          ? success({
              task: { id: result.task.id },
              operation: result.operation,
              added: result.added,
              removed: result.removed,
              unchanged: result.unchanged,
              prerequisites: result.task.prerequisites,
            })
          : dependencyError(dependent.taskId, result),
    );
  });
};

const dependencyError = (
  taskId: PublicTaskId,
  result: Exclude<EditTaskDependenciesResult, { readonly ok: true }>,
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
    message: dependencyErrorMessage(taskId, result),
    details,
    help: [
      result.code === "dependencies_locked"
        ? result.state === "todo"
          ? `Run \`by task revise ${taskId}\` before changing approved Task dependencies.`
          : "Dependency edits are available only before Change Start."
        : result.code === "replace_requires_dependency"
          ? "Use `by task dependencies clear <task-id>` to remove all prerequisites."
          : "Use existing Tasks and keep the direct dependency graph acyclic.",
    ],
  });
};

const dependencyErrorMessage = (
  taskId: PublicTaskId,
  result: Exclude<EditTaskDependenciesResult, { readonly ok: true }>,
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
    case "replace_requires_dependency":
      return "The replace operation requires at least one prerequisite.";
    case "dependencies_locked":
      return result.state === "todo"
        ? `Dependencies for task ${taskId} are locked until the Task is opened for revision.`
        : `Dependencies for task ${taskId} are locked after Start.`;
  }
};
