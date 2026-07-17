import type { CliResult } from "../../../cliResults.js";
import { runtimeError, stateStoreUnavailable, success, usageError } from "../../../cliResults.js";
import { withGlobalHelpFlags } from "../../../cliHelp.js";
import {
  readDescriptionFile,
  type DescriptionFileReadError,
} from "../../../task/files/descriptionFile.js";
import { parseCliTaskIdValue } from "../../../cliTaskId.js";
import { TaskDependencyValidationError } from "../../../task/task.js";
import type { PublicTaskId } from "../../../task/taskId.js";
import { loadTasks, resolveTaskId, type TaskCommandEnvironment } from "../taskCliSupport.js";

export const runCreateCommand = (
  args: readonly string[],
  environment: TaskCommandEnvironment,
): CliResult => {
  if (args.length === 1 && args[0] === "--help") {
    return success({
      usage: "by task create --title <title> --description-file <file> [--depends-on <task-id>]...",
      flags: withGlobalHelpFlags([
        {
          flag: "--title <title>",
          description: "Required Task title",
        },
        {
          flag: "--description-file <file>",
          description: "Required UTF-8 Task description file, max 256 KiB",
        },
        {
          flag: "--depends-on <task-id>",
          description: "Direct prerequisite; repeat for multiple Tasks",
        },
      ]),
      examples: ['by task create --title "Add login" --description-file task.md'],
    });
  }

  const parseResult = parseTaskCreateArgs(args);

  if (!parseResult.ok) {
    return parseResult.result;
  }

  if (parseResult.title === undefined) {
    return usageError({
      code: "missing_title",
      message: "--title is required.",
      help: ['Run `by task create --title "..." --description-file <file>` to create a task.'],
    });
  }

  const title = parseResult.title.trim();

  if (title.length === 0) {
    return usageError({
      code: "empty_title",
      message: "Task title must not be empty.",
      help: ['Provide a non-empty title with `--title "..."`.'],
    });
  }

  if (/[\r\n]/u.test(title)) {
    return usageError({
      code: "invalid_task_title",
      message: "Task title must be one line.",
      help: ['Provide a one-line title with `--title "..."`.'],
    });
  }

  if (parseResult.descriptionFile === undefined) {
    return usageError({
      code: "missing_description_file",
      message: "--description-file is required.",
      help: ['Run `by task create --title "..." --description-file <file>` to create a task.'],
    });
  }

  const tasksLoad = loadTasks(environment, true);

  if (!tasksLoad.ok) {
    return tasksLoad.result;
  }

  const description = readDescriptionFile(environment.cwd, parseResult.descriptionFile);

  if (!description.ok) {
    return descriptionFileError(description.error);
  }

  const dependencies = resolveDependencies(parseResult.dependsOn, tasksLoad.tasks);
  if (!dependencies.ok) return dependencies.result;

  try {
    const task = tasksLoad.tasks.createTask({
      title,
      description: description.content,
      now: environment.now().toISOString(),
      dependsOn: dependencies.taskIds,
    });

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
  } catch (error) {
    if (error instanceof TaskDependencyValidationError) {
      return dependencyError(error);
    }
    return stateStoreUnavailable(tasksLoad.tasks.taskPrefix);
  }
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

type TaskCreateArgsParseResult =
  | {
      readonly ok: true;
      readonly title: string | undefined;
      readonly descriptionFile: string | undefined;
      readonly dependsOn: readonly string[];
    }
  | {
      readonly ok: false;
      readonly result: CliResult;
    };

const parseTaskCreateArgs = (args: readonly string[]): TaskCreateArgsParseResult => {
  let title: string | undefined;
  let descriptionFile: string | undefined;
  const dependsOn: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    const option = createOptions[arg];

    if (option === undefined) {
      return unknownTaskCreateInput(arg);
    }

    const value = args[index + 1];

    if (value === undefined || value.startsWith("-")) {
      return missingCreateOptionValue(option, title, descriptionFile, dependsOn);
    }

    if (option === "title") {
      title = value;
    } else if (option === "descriptionFile") {
      descriptionFile = value;
    } else {
      dependsOn.push(value);
    }

    index += 1;
  }

  return { ok: true, title, descriptionFile, dependsOn };
};

type CreateOption = "title" | "descriptionFile" | "dependsOn";

const createOptions: Partial<Record<string, CreateOption>> = {
  "--title": "title",
  "--description-file": "descriptionFile",
  "--depends-on": "dependsOn",
};

const missingCreateOptionValue = (
  option: CreateOption,
  title: string | undefined,
  descriptionFile: string | undefined,
  dependsOn: readonly string[],
): TaskCreateArgsParseResult =>
  option === "title"
    ? { ok: true, title: undefined, descriptionFile, dependsOn }
    : option === "descriptionFile"
      ? { ok: true, title, descriptionFile: undefined, dependsOn }
      : {
          ok: false,
          result: usageError({
            code: "missing_dependency_task_id",
            message: "--depends-on requires a Task ID.",
            help: ["Provide a Task ID after `--depends-on`."],
          }),
        };

const unknownTaskCreateInput = (arg: string): TaskCreateArgsParseResult => ({
  ok: false,
  result: usageError({
    code: arg.startsWith("-") ? "unknown_flag" : "unknown_argument",
    message: `${arg.startsWith("-") ? "Unknown flag" : "Unknown argument"}: ${arg}`,
    help: ["Run `by task create --help`."],
  }),
});

const dependencyError = (error: TaskDependencyValidationError): CliResult =>
  runtimeError({
    code: error.code,
    message: dependencyErrorMessage(error),
    ...(error.taskId === undefined ? {} : { details: { taskId: error.taskId } }),
    help: ["Use existing Tasks from `by task list --all` as direct prerequisites."],
  });

const dependencyErrorMessage = (error: TaskDependencyValidationError): string => {
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
  }
};
