import type { CliResult } from "../../../cliResults.js";
import { runtimeError, stateStoreUnavailable, success, usageError } from "../../../cliResults.js";
import { withGlobalHelpFlags } from "../../../cliHelp.js";
import { parseCliTaskIdValue } from "../../../cliTaskId.js";
import type { PublicTaskId } from "../../../task/taskId.js";
import type { RepoReplaceTaskDependenciesResult } from "../../../task/taskUseCases.js";
import {
  loadTasks,
  resolveTaskId,
  taskNotFound,
  type TaskCommandEnvironment,
} from "../taskCliSupport.js";

export const runDependenciesCommand = (
  args: readonly string[],
  environment: TaskCommandEnvironment,
): CliResult => {
  if (args.length === 1 && args[0] === "--help") {
    return success({
      usage: "by task dependencies set <task-id> [--depends-on <task-id>]...",
      flags: withGlobalHelpFlags([
        {
          flag: "--depends-on <task-id>",
          description: "Direct prerequisite; repeat for multiple Tasks",
        },
      ]),
      examples: [
        "by task dependencies set BY-3 --depends-on BY-1 --depends-on BY-2",
        "by task dependencies set BY-3",
      ],
    });
  }

  if (args[0] !== "set") {
    return usageError({
      code: "unknown_command",
      message: `Unknown task dependencies command: ${args[0] ?? ""}`,
      help: ["Run `by task dependencies --help`."],
    });
  }

  const parsed = parseSetArgs(args.slice(1));
  if (!parsed.ok) return parsed.result;

  const loaded = loadTasks(environment, false);
  if (!loaded.ok) return loaded.result;

  const parsedDependent = parseCliTaskIdValue(parsed.taskId);
  if (!parsedDependent.ok) return parsedDependent.result;
  const dependent = resolveTaskId(loaded.tasks, parsedDependent.taskId);
  if (!dependent.ok) return dependent.result;

  const prerequisiteTaskIds: PublicTaskId[] = [];
  for (const value of parsed.dependsOn) {
    const parsedPrerequisite = parseCliTaskIdValue(value);
    if (!parsedPrerequisite.ok) return parsedPrerequisite.result;
    const prerequisite = resolveTaskId(loaded.tasks, parsedPrerequisite.taskId);
    if (!prerequisite.ok) return prerequisite.result;
    prerequisiteTaskIds.push(prerequisite.taskId);
  }

  try {
    const result = loaded.tasks.replaceTaskDependencies(dependent.taskId, prerequisiteTaskIds);
    if (!result.ok) return replaceError(dependent.taskId, result);

    return success({
      task: {
        id: result.task.id,
        prerequisites: result.task.prerequisites,
      },
    });
  } catch {
    return stateStoreUnavailable(loaded.tasks.taskPrefix);
  }
};

type ParseResult =
  | { readonly ok: true; readonly taskId: string; readonly dependsOn: readonly string[] }
  | { readonly ok: false; readonly result: CliResult };

const parseSetArgs = (args: readonly string[]): ParseResult => {
  const taskId = args[0];
  if (taskId === undefined || taskId.startsWith("-")) {
    return {
      ok: false,
      result: usageError({
        code: "missing_task_id",
        message: "Task ID is required.",
        help: ["Run `by task dependencies set <task-id> [--depends-on <task-id>]...`."],
      }),
    };
  }

  const dependsOn: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg !== "--depends-on") {
      return {
        ok: false,
        result: usageError({
          code: arg?.startsWith("-") ? "unknown_flag" : "unknown_argument",
          message: `${arg?.startsWith("-") ? "Unknown flag" : "Unknown argument"}: ${arg ?? ""}`,
          help: ["Run `by task dependencies --help`."],
        }),
      };
    }

    const value = args[index + 1];
    if (value === undefined || value.startsWith("-")) {
      return {
        ok: false,
        result: usageError({
          code: "missing_dependency_task_id",
          message: "--depends-on requires a Task ID.",
          help: ["Provide a Task ID after `--depends-on`."],
        }),
      };
    }
    dependsOn.push(value);
    index += 1;
  }

  return { ok: true, taskId, dependsOn };
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
