import type { CliResult } from "../../../cliResults.js";
import { stateStoreUnavailable, success, usageError } from "../../../cliResults.js";
import { withGlobalHelpFlags } from "../../../cliHelp.js";
import {
  readDescriptionFile,
  type DescriptionFileReadError,
} from "../../../task/files/descriptionFile.js";
import { loadTasks, type TaskCommandEnvironment } from "../taskCliSupport.js";

export const runCreateCommand = (
  args: readonly string[],
  environment: TaskCommandEnvironment,
): CliResult => {
  if (args.length === 1 && args[0] === "--help") {
    return success({
      usage: "by task create --title <title> --description-file <file>",
      flags: withGlobalHelpFlags([
        {
          flag: "--title <title>",
          description: "Required Task title",
        },
        {
          flag: "--description-file <file>",
          description: "Required UTF-8 Task description file, max 256 KiB",
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

  try {
    const task = tasksLoad.tasks.createTask({
      title,
      description: description.content,
      now: environment.now().toISOString(),
    });

    return success({
      task,
      help: ["Run `by task list` to see open tasks."],
    });
  } catch {
    return stateStoreUnavailable(tasksLoad.tasks.taskPrefix);
  }
};

type TaskCreateArgsParseResult =
  | {
      readonly ok: true;
      readonly title: string | undefined;
      readonly descriptionFile: string | undefined;
    }
  | {
      readonly ok: false;
      readonly result: CliResult;
    };

const parseTaskCreateArgs = (args: readonly string[]): TaskCreateArgsParseResult => {
  let title: string | undefined;
  let descriptionFile: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    const option = createOptions[arg];

    if (option === undefined) {
      return unknownTaskCreateInput(arg);
    }

    const value = args[index + 1];

    if (value === undefined || value.startsWith("-")) {
      return missingCreateOptionValue(option, title, descriptionFile);
    }

    if (option === "title") {
      title = value;
    } else {
      descriptionFile = value;
    }

    index += 1;
  }

  return { ok: true, title, descriptionFile };
};

type CreateOption = "title" | "descriptionFile";

const createOptions: Partial<Record<string, CreateOption>> = {
  "--title": "title",
  "--description-file": "descriptionFile",
};

const missingCreateOptionValue = (
  option: CreateOption,
  title: string | undefined,
  descriptionFile: string | undefined,
): TaskCreateArgsParseResult =>
  option === "title"
    ? { ok: true, title: undefined, descriptionFile }
    : { ok: true, title, descriptionFile: undefined };

const unknownTaskCreateInput = (arg: string): TaskCreateArgsParseResult => ({
  ok: false,
  result: usageError({
    code: arg.startsWith("-") ? "unknown_flag" : "unknown_argument",
    message: `${arg.startsWith("-") ? "Unknown flag" : "Unknown argument"}: ${arg}`,
    help: ["Run `by task create --help`."],
  }),
});

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
