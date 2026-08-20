// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import {
  type RecordingTextReadError,
  readRecordingText,
} from "../../../cli/input/recordingText.js";
import type { CliResult } from "../../../cliResults.js";
import { runtimeError, success, usageError } from "../../../cliResults.js";
import { parseCliTaskIdValue } from "../../../cliTaskId.js";
import type { DependencyValidationCode } from "../../../task/task.js";
import type { PublicTaskId } from "../../../task/taskId.js";
import {
  resolveTaskId,
  type TaskCommandEnvironment,
  taskMutationView,
  withTasks,
} from "../taskCliSupport.js";
import { normalizeTaskTitle, taskTitleInputError } from "../taskTitle.js";

export type TaskCreateCommand = {
  readonly title: string;
  readonly file: string;
  readonly dependsOn: readonly string[];
};

export const runCreateCommand = (
  command: TaskCreateCommand,
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  const title = normalizeTaskTitle(command.title);
  if (!title.ok) return Effect.succeed(taskTitleInputError(title));
  const description = readRecordingText(environment.cwd, command.file, environment.stdin);
  if (!description.ok) return Effect.succeed(descriptionInputError(description.error));

  return withTasks(environment, (tasks) => {
    const dependencies = resolveDependencies(command.dependsOn, tasks);
    if (!dependencies.ok) return Effect.succeed(dependencies.result);
    return Effect.map(
      tasks.createTask({
        title: title.title,
        description: description.content,
        now: environment.now().toISOString(),
        dependsOn: dependencies.taskIds,
      }),
      (result) => {
        if (!result.ok) return dependencyError(result);
        const task = result.task;
        return success({
          task: taskMutationView(task),
          context: result.context,
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

const descriptionInputError = (error: RecordingTextReadError): CliResult => {
  switch (error.code) {
    case "recording_text_file_not_found":
      return usageError({
        code: "description_file_not_found",
        message: "Task description file was not found.",
        details: { path: error.path },
        help: ['Create the file, then rerun `by task create --title "..." --file <path|->`.'],
      });
    case "recording_text_file_unreadable":
    case "recording_text_stdin_unreadable":
      return usageError({
        code: "description_file_unreadable",
        message: "Task description input is not readable.",
        details: "path" in error ? { path: error.path } : { path: "-" },
        help: ["Use a readable UTF-8 file or pipe UTF-8 text with `--file -`."],
      });
    case "recording_text_invalid_utf8":
      return usageError({
        code: "invalid_description_encoding",
        message: "Task description input must be valid UTF-8.",
        details: { path: error.path },
        help: ["Rewrite the input as UTF-8 and rerun the command."],
      });
    case "recording_text_too_large":
      return usageError({
        code: "description_too_large",
        message: "Task description input is larger than 256 KiB.",
        details: { path: error.path, maxBytes: error.maxBytes },
        help: ["Shorten the input to 256 KiB or less."],
      });
    case "recording_text_blank":
      return usageError({
        code: "empty_description",
        message: "Task description must not be blank.",
        details: { path: error.path },
        help: ["Provide non-blank text with `--file <path|->`."],
      });
    case "stdin_is_terminal":
      return usageError({
        code: error.code,
        message: "Standard input is an interactive terminal.",
        help: ["Pipe UTF-8 text or use a shell heredoc with `--file -`."],
      });
  }
};
