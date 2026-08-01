// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";

import type { CliResult } from "../../../cliResults.js";
import { runtimeError, success, usageError } from "../../../cliResults.js";
import {
  readDescriptionFile,
  type DescriptionFileReadError,
} from "../../../task/files/descriptionFile.js";
import { parseCliTaskIdValue } from "../../../cliTaskId.js";
import type { DependencyValidationCode } from "../../../task/task.js";
import type { PublicTaskId } from "../../../task/taskId.js";
import { resolveTaskId, withTasks, type TaskCommandEnvironment } from "../taskCliSupport.js";

export type TaskCreateCommand = {
  readonly title: string;
  readonly descriptionFile: string;
  readonly dependsOn: readonly string[];
};

export const runCreateCommand = (
  command: TaskCreateCommand,
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  const title = command.title.trim();
  if (title.length === 0)
    return Effect.succeed(
      usageError({
        code: "empty_title",
        message: "Task title must not be empty.",
        help: ['Provide a non-empty title with `--title "..."`.'],
      }),
    );
  if (/[\r\n]/u.test(title))
    return Effect.succeed(
      usageError({
        code: "invalid_task_title",
        message: "Task title must be one line.",
        help: ['Provide a one-line title with `--title "..."`.'],
      }),
    );
  const description = readDescriptionFile(
    environment.cwd,
    command.descriptionFile,
    environment.stdin,
  );
  if (!description.ok) return Effect.succeed(descriptionFileError(description.error));

  return withTasks(environment, true, (tasks) => {
    const dependencies = resolveDependencies(command.dependsOn, tasks);
    if (!dependencies.ok) return Effect.succeed(dependencies.result);
    return Effect.map(
      tasks.createTask({
        title,
        description: description.content,
        now: environment.now().toISOString(),
        dependsOn: dependencies.taskIds,
      }),
      (result) => {
        if (!result.ok) return dependencyError(result);
        const task = result.task;
        return success({
          task: {
            id: task.id,
            title: task.title,
            state: task.state,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
          },
          help: ["Run `by task list` to see open tasks."],
        });
      },
    );
  });
};

type ResolveDependenciesResult =
  | { readonly ok: true; readonly taskIds: readonly PublicTaskId[] }
  | { readonly ok: false; readonly result: CliResult };

const resolveDependencies = (
  dependencies: readonly string[],
  tasks: Parameters<typeof resolveTaskId>[0],
): ResolveDependenciesResult => {
  const taskIds: PublicTaskId[] = [];
  for (const dependency of dependencies) {
    const parsed = parseCliTaskIdValue(dependency);
    if (!parsed.ok) return parsed;
    const resolved = resolveTaskId(tasks, parsed.taskId);
    if (!resolved.ok) return resolved;
    taskIds.push(resolved.taskId);
  }
  return { ok: true, taskIds };
};

const dependencyError = (error: {
  readonly code: DependencyValidationCode;
  readonly taskId?: PublicTaskId;
}): CliResult =>
  runtimeError({
    code: error.code,
    message: dependencyErrorMessage(error),
    ...(error.taskId === undefined ? {} : { details: { taskId: error.taskId } }),
    help: ["Use existing Tasks from `by task list --all --limit all` as direct prerequisites."],
  });

const dependencyErrorMessage = (error: {
  readonly code: DependencyValidationCode;
  readonly taskId?: PublicTaskId;
}): string => {
  switch (error.code) {
    case "dependency_unknown_task":
      return `Dependency Task was not found: ${error.taskId ?? ""}`;
    case "dependency_self":
      return "A Task cannot depend on itself.";
    case "dependency_duplicate":
      return `Dependency was provided more than once: ${error.taskId ?? ""}`;
    case "dependency_cycle":
      return "Task dependencies must not contain a cycle.";
  }
};

const descriptionFileError = (error: DescriptionFileReadError): CliResult => {
  switch (error.code) {
    case "description_file_not_found":
      return usageError({
        code: error.code,
        message: "Task description file was not found.",
        details: { path: error.path },
        help: [
          'Create the file, then rerun `by task create --title "..." --description-file <file>`.',
        ],
      });
    case "description_file_unreadable":
      return usageError({
        code: error.code,
        message: "Task description file is not readable.",
        details: { path: error.path },
        help: ["Use a readable UTF-8 file for `--description-file`."],
      });
    case "invalid_description_encoding":
      return usageError({
        code: error.code,
        message: "Task description file must be valid UTF-8.",
        details: { path: error.path },
        help: ["Rewrite the description file as UTF-8 and rerun the command."],
      });
    case "description_too_large":
      return usageError({
        code: error.code,
        message: "Task description file is larger than 256 KiB.",
        details: { path: error.path, maxBytes: error.maxBytes },
        help: ["Shorten the description file to 256 KiB or less."],
      });
    case "empty_description":
      return usageError({
        code: error.code,
        message: "Task description must not be empty.",
        details: { path: error.path },
        help: ["Write a non-empty description file and rerun the command."],
      });
    case "stdin_is_terminal":
      return usageError({
        code: error.code,
        message: "Standard input is an interactive terminal.",
        help: ["Pipe UTF-8 text or use a shell heredoc with --description-file -."],
      });
  }
};
