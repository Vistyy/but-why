import { Effect } from "effect";

import type { CliResult } from "../../../cliResults.js";
import { runtimeError, success, usageError } from "../../../cliResults.js";
import { parseCliTaskIdValue } from "../../../cliTaskId.js";
import type { PublicTaskId } from "../../../task/taskId.js";
import type { RepoEditTaskDependenciesResult } from "../../../task/taskUseCases.js";
import type { TaskDependencyOperation } from "../../../task/taskStore.js";
import {
  resolveTaskId,
  withTasks,
  taskNotFound,
  type TaskCommandEnvironment,
} from "../taskCliSupport.js";

export type TaskDependenciesCommand = {
  readonly operation: TaskDependencyOperation;
  readonly taskId: string;
  readonly dependsOn: readonly string[];
};

export const dependencyOptionRequiredError = (operation: "add" | "remove" | "replace"): CliResult =>
  usageError({
    code: operation === "replace" ? "replace_requires_dependency" : "depends_on_required",
    message:
      operation === "replace"
        ? "The replace operation requires at least one prerequisite."
        : `The ${operation} operation requires at least one --depends-on value.`,
    help: [
      operation === "replace"
        ? "Use `by task dependencies clear <task-id>` to remove all prerequisites."
        : `Use \`by task dependencies ${operation} <task-id> --depends-on <task-id>\`.`,
    ],
  });

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
      tasks.editTaskDependencies({
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
  result: Exclude<RepoEditTaskDependenciesResult, { readonly ok: true }>,
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
        ? "Dependency edits are available only before Change Start."
        : result.code === "replace_requires_dependency"
          ? "Use `by task dependencies clear <task-id>` to remove all prerequisites."
          : "Use existing Tasks and keep the direct dependency graph acyclic.",
    ],
  });
};

const dependencyErrorMessage = (
  taskId: PublicTaskId,
  result: Exclude<RepoEditTaskDependenciesResult, { readonly ok: true }>,
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
      return `Dependencies for task ${taskId} are locked after Start.`;
  }
};
