import { existsSync } from "node:fs";
import { join } from "node:path";

import type { CliEnvironment, CliResult } from "../cli.js";
import { findGitRoot } from "../init/git.js";
import { taskPrefixPattern } from "../init/initRepo.js";
import { readRepoConfig } from "../init/repoConfig.js";
import type { ToonObject, ToonValue } from "../output/toon.js";
import { readCommentFile, type CommentFileReadError } from "./commentFile.js";
import { readDescriptionFile, type DescriptionFileReadError } from "./descriptionFile.js";
import {
  appendTaskComment,
  createTask,
  getTaskById,
  getTaskContextById,
  listActionableTasks,
  listTasks,
} from "./taskStore.js";
import {
  isTaskState,
  taskStates,
  type TaskRecord,
  type TaskState,
  type TaskSummary,
} from "./task.js";
import {
  hasPublicTaskIdShape,
  isTaskIdForPrefix,
  publicTaskId,
  type PublicTaskId,
} from "./taskId.js";

export const routeTask = (args: readonly string[], environment: CliEnvironment): CliResult => {
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    return success(taskHelpView());
  }

  const subcommand = args[0];

  if (subcommand === "create") {
    return routeTaskCreate(args.slice(1), environment);
  }

  if (subcommand === "list") {
    return routeTaskList(args.slice(1), environment);
  }

  if (subcommand === "show") {
    return routeTaskShow(args.slice(1), environment);
  }

  if (subcommand === "context") {
    return routeTaskContextCommand(args.slice(1), environment);
  }

  if (subcommand === "comment") {
    return routeTaskComment(args.slice(1), environment);
  }

  if (subcommand?.startsWith("-")) {
    return usageError({
      code: "unknown_flag",
      message: `Unknown flag: ${subcommand}`,
      help: ["Run `by task --help`."],
    });
  }

  return usageError({
    code: "unknown_command",
    message: `Unknown task command: ${subcommand ?? ""}`,
    help: ["Run `by task --help`."],
  });
};

export const dashboard = (
  bin: string,
  description: string,
  environment: CliEnvironment,
): CliResult => {
  const context = loadTaskContext(environment.cwd);

  if (!context.ok) {
    return context.result;
  }

  try {
    const tasks = listActionableTasks(context.statePath);

    return success({
      bin,
      description,
      count: tasks.length,
      tasks: taskSummaryRows(tasks),
      ...(tasks.length === 0 ? { help: [createTaskHelp] } : {}),
    });
  } catch {
    return stateStoreUnavailable(context.taskPrefix);
  }
};

const routeTaskCreate = (args: readonly string[], environment: CliEnvironment): CliResult => {
  if (args.length === 1 && args[0] === "--help") {
    return success({
      usage: "by task create --title <title> --description-file <file>",
      flags: [
        {
          flag: "--title <title>",
          description: "Required Task title",
        },
        {
          flag: "--description-file <file>",
          description: "Required UTF-8 Task description file, max 256 KiB",
        },
        {
          flag: "--help",
          description: "Show this help",
        },
      ],
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

  if (parseResult.descriptionFile === undefined) {
    return usageError({
      code: "missing_description_file",
      message: "--description-file is required.",
      help: ['Run `by task create --title "..." --description-file <file>` to create a task.'],
    });
  }

  const context = loadTaskContext(environment.cwd);

  if (!context.ok) {
    return context.result;
  }

  const description = readDescriptionFile(environment.cwd, parseResult.descriptionFile);

  if (!description.ok) {
    return descriptionFileError(description.error);
  }

  try {
    const task = createTask({
      statePath: context.statePath,
      taskPrefix: context.taskPrefix,
      title,
      description: description.content,
      now: environment.now().toISOString(),
    });

    return success({
      task,
      help: ["Run `by task list` to see open tasks."],
    });
  } catch {
    return stateStoreUnavailable(context.taskPrefix);
  }
};

const routeTaskList = (args: readonly string[], environment: CliEnvironment): CliResult => {
  if (args.length === 1 && args[0] === "--help") {
    return success({
      usage: "by task list [--all] [--state <state>]",
      flags: [
        {
          flag: "--all",
          description: "Include done Tasks",
        },
        {
          flag: "--state <state>",
          description: "Show only Tasks in one state",
        },
        {
          flag: "--help",
          description: "Show this help",
        },
      ],
      examples: ["by task list", "by task list --all", "by task list --state needs_input"],
    });
  }

  const parseResult = parseTaskListArgs(args);

  if (!parseResult.ok) {
    return parseResult.result;
  }

  const context = loadTaskContext(environment.cwd);

  if (!context.ok) {
    return context.result;
  }

  try {
    const tasks = listTasks({
      statePath: context.statePath,
      includeDone: parseResult.all || parseResult.state !== undefined,
      ...(parseResult.state === undefined ? {} : { state: parseResult.state }),
    });

    return success({
      count: tasks.length,
      tasks: taskSummaryRows(tasks),
      ...(tasks.length === 0 ? { help: [createTaskHelp] } : {}),
    });
  } catch {
    return stateStoreUnavailable(context.taskPrefix);
  }
};

const routeTaskShow = (args: readonly string[], environment: CliEnvironment): CliResult => {
  if (args.length === 1 && args[0] === "--help") {
    return taskDetailHelp("by task show <task-id>", "by task show BY-1");
  }

  return routeExistingTask(args, environment, "by task show <task-id>", (task) =>
    success({
      task: {
        id: task.id,
        title: task.title,
        state: task.state,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        branch: null,
        latestRun: null,
        tokenTotals: null,
        commentCount: task.commentCount,
      },
    }),
  );
};

const routeTaskContextCommand = (
  args: readonly string[],
  environment: CliEnvironment,
): CliResult => {
  if (args.length === 1 && args[0] === "--help") {
    return taskDetailHelp("by task context <task-id>", "by task context BY-1");
  }

  return routeExistingTaskContext(args, environment);
};

const routeTaskComment = (args: readonly string[], environment: CliEnvironment): CliResult => {
  if (args.length === 1 && args[0] === "--help") {
    return success({
      usage: "by task comment <task-id> --file <file>",
      arguments: [
        {
          argument: "<task-id>",
          description: "Public Task ID, such as BY-1",
        },
      ],
      flags: [
        {
          flag: "--file <file>",
          description: "Required UTF-8 Markdown comment file. Stdin is not supported.",
        },
        {
          flag: "--help",
          description: "Show this help",
        },
      ],
      examples: ["by task comment BY-1 --file comment.md"],
    });
  }

  const parseResult = parseTaskCommentArgs(args);

  if (!parseResult.ok) {
    return parseResult.result;
  }

  if (parseResult.commentFile === undefined) {
    return usageError({
      code: "missing_comment_file",
      message: "--file is required.",
      help: ["Run `by task comment <task-id> --file <file>` to append a Task comment."],
    });
  }

  const repoContext = loadTaskContext(environment.cwd);

  if (!repoContext.ok) {
    return repoContext.result;
  }

  const taskId = validateTaskIdPrefix(parseResult.taskId, repoContext.taskPrefix);

  if (!taskId.ok) {
    return taskId.result;
  }

  try {
    if (getTaskById(repoContext.statePath, taskId.taskId) === undefined) {
      return taskNotFound(taskId.taskId);
    }
  } catch {
    return stateStoreUnavailable(repoContext.taskPrefix);
  }

  if (parseResult.commentFile === "-") {
    return runtimeError({
      code: "unsupported_stdin_comment_file",
      message: "Reading Task comments from stdin is not supported in v1.",
      help: ["Write the comment to a file, then rerun `by task comment <task-id> --file <file>`."],
    });
  }

  const comment = readCommentFile(environment.cwd, parseResult.commentFile);

  if (!comment.ok) {
    return commentFileError(comment.error);
  }

  try {
    const result = appendTaskComment({
      statePath: repoContext.statePath,
      taskId: taskId.taskId,
      content: comment.content,
      now: () => environment.now().toISOString(),
    });

    if (result === undefined) {
      return taskNotFound(taskId.taskId);
    }

    return success({
      task: {
        id: result.taskId,
        commentCount: result.commentCount,
      },
    });
  } catch {
    return stateStoreUnavailable(repoContext.taskPrefix);
  }
};

const taskDetailHelp = (usage: string, example: string): CliResult =>
  success({
    usage,
    arguments: [
      {
        argument: "<task-id>",
        description: "Public Task ID, such as BY-1",
      },
    ],
    examples: [example],
  });

const routeExistingTask = (
  args: readonly string[],
  environment: CliEnvironment,
  usage: string,
  render: (task: TaskRecord) => CliResult,
): CliResult => {
  const taskIdShape = parseTaskIdShape(args, usage);

  if (!taskIdShape.ok) {
    return taskIdShape.result;
  }

  const context = loadTaskConfigContext(environment.cwd);

  if (!context.ok) {
    return context.result;
  }

  const taskId = validateTaskIdPrefix(taskIdShape.taskId, context.taskPrefix);

  if (!taskId.ok) {
    return taskId.result;
  }

  if (!existsSync(context.statePath)) {
    return stateStoreUnavailable(context.taskPrefix);
  }

  try {
    const task = getTaskById(context.statePath, taskId.taskId);

    if (task === undefined) {
      return taskNotFound(taskId.taskId);
    }

    return render(task);
  } catch {
    return stateStoreUnavailable(context.taskPrefix);
  }
};

const routeExistingTaskContext = (
  args: readonly string[],
  environment: CliEnvironment,
): CliResult => {
  const taskIdShape = parseTaskIdShape(args, "by task context <task-id>");

  if (!taskIdShape.ok) {
    return taskIdShape.result;
  }

  const context = loadTaskConfigContext(environment.cwd);

  if (!context.ok) {
    return context.result;
  }

  const taskId = validateTaskIdPrefix(taskIdShape.taskId, context.taskPrefix);

  if (!taskId.ok) {
    return taskId.result;
  }

  if (!existsSync(context.statePath)) {
    return stateStoreUnavailable(context.taskPrefix);
  }

  try {
    const task = getTaskContextById(context.statePath, taskId.taskId);

    if (task === undefined) {
      return taskNotFound(taskId.taskId);
    }

    return success({ task });
  } catch {
    return stateStoreUnavailable(context.taskPrefix);
  }
};

type TaskIdArgParseResult =
  | {
      readonly ok: true;
      readonly taskId: PublicTaskId;
    }
  | {
      readonly ok: false;
      readonly result: CliResult;
    };

const parseTaskIdShape = (args: readonly string[], usage: string): TaskIdArgParseResult => {
  const [taskId, extraArg] = args;

  if (taskId === undefined) {
    return {
      ok: false,
      result: usageError({
        code: "missing_task_id",
        message: "Task ID is required.",
        help: [`Run \`${usage}\`.`],
      }),
    };
  }

  if (extraArg !== undefined) {
    return {
      ok: false,
      result: usageError({
        code: "unknown_argument",
        message: `Unknown argument: ${extraArg}`,
        help: [`Run \`${usage}\`.`],
      }),
    };
  }

  if (!hasPublicTaskIdShape(taskId)) {
    return invalidTaskId(taskId, "<PREFIX>-<number>", "Use a public Task ID such as BY-1.");
  }

  return { ok: true, taskId: publicTaskId(taskId) };
};

const validateTaskIdPrefix = (taskId: PublicTaskId, taskPrefix: string): TaskIdArgParseResult => {
  if (!isTaskIdForPrefix(taskId, taskPrefix)) {
    return invalidTaskId(
      taskId,
      `${taskPrefix}-<number>`,
      `Use a public Task ID such as ${taskPrefix}-1.`,
    );
  }

  return { ok: true, taskId };
};

const invalidTaskId = (
  taskId: string,
  expectedFormat: string,
  help: string,
): Extract<TaskIdArgParseResult, { readonly ok: false }> => ({
  ok: false,
  result: usageError({
    code: "invalid_task_id",
    message: `Invalid Task ID: ${taskId}`,
    details: { taskId, expectedFormat },
    help: [help],
  }),
});

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

type TaskCommentArgsParseResult =
  | {
      readonly ok: true;
      readonly taskId: PublicTaskId;
      readonly commentFile: string | undefined;
    }
  | {
      readonly ok: false;
      readonly result: CliResult;
    };

const parseTaskCreateArgs = (args: readonly string[]): TaskCreateArgsParseResult => {
  let title: string | undefined;
  let descriptionFile: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--title") {
      const value = args[index + 1];

      if (value === undefined || value.startsWith("-")) {
        return { ok: true, title: undefined, descriptionFile };
      }

      title = value;
      index += 1;
      continue;
    }

    if (arg === "--description-file") {
      const value = args[index + 1];

      if (value === undefined || value.startsWith("-")) {
        return { ok: true, title, descriptionFile: undefined };
      }

      descriptionFile = value;
      index += 1;
      continue;
    }

    if (arg?.startsWith("-")) {
      return {
        ok: false,
        result: usageError({
          code: "unknown_flag",
          message: `Unknown flag: ${arg}`,
          help: ["Run `by task create --help`."],
        }),
      };
    }

    return {
      ok: false,
      result: usageError({
        code: "unknown_argument",
        message: `Unknown argument: ${arg ?? ""}`,
        help: ["Run `by task create --help`."],
      }),
    };
  }

  return { ok: true, title, descriptionFile };
};

const parseTaskCommentArgs = (args: readonly string[]): TaskCommentArgsParseResult => {
  const [taskIdArg, ...rest] = args;

  if (taskIdArg === undefined) {
    return {
      ok: false,
      result: usageError({
        code: "missing_task_id",
        message: "Task ID is required.",
        help: ["Run `by task comment <task-id> --file <file>`."],
      }),
    };
  }

  if (!hasPublicTaskIdShape(taskIdArg)) {
    return invalidTaskId(taskIdArg, "<PREFIX>-<number>", "Use a public Task ID such as BY-1.");
  }

  let commentFile: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    if (arg === "--file") {
      const value = rest[index + 1];

      if (value === undefined) {
        return { ok: true, taskId: publicTaskId(taskIdArg), commentFile: undefined };
      }

      commentFile = value;
      index += 1;
      continue;
    }

    if (arg?.startsWith("-")) {
      return {
        ok: false,
        result: usageError({
          code: "unknown_flag",
          message: `Unknown flag: ${arg}`,
          help: ["Run `by task comment --help`."],
        }),
      };
    }

    return {
      ok: false,
      result: usageError({
        code: "unknown_argument",
        message: `Unknown argument: ${arg ?? ""}`,
        help: ["Run `by task comment --help`."],
      }),
    };
  }

  return { ok: true, taskId: publicTaskId(taskIdArg), commentFile };
};

type TaskListArgsParseResult =
  | {
      readonly ok: true;
      readonly all: boolean;
      readonly state: TaskState | undefined;
    }
  | {
      readonly ok: false;
      readonly result: CliResult;
    };

const parseTaskListArgs = (args: readonly string[]): TaskListArgsParseResult => {
  let all = false;
  let state: TaskState | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--all") {
      all = true;
      continue;
    }

    if (arg === "--state") {
      const value = args[index + 1];

      if (value === undefined || value.startsWith("-")) {
        return invalidTaskState("");
      }

      if (!isTaskState(value)) {
        return invalidTaskState(value);
      }

      state = value;
      index += 1;
      continue;
    }

    if (arg?.startsWith("-")) {
      return {
        ok: false,
        result: usageError({
          code: "unknown_flag",
          message: `Unknown flag: ${arg}`,
          help: ["Run `by task list --help`."],
        }),
      };
    }

    return {
      ok: false,
      result: usageError({
        code: "unknown_argument",
        message: `Unknown argument: ${arg ?? ""}`,
        help: ["Run `by task list --help`."],
      }),
    };
  }

  return { ok: true, all, state };
};

const invalidTaskState = (state: string): TaskListArgsParseResult => ({
  ok: false,
  result: usageError({
    code: "invalid_task_state",
    message: `Unknown task state ${state}.`,
    details: { state },
    help: [`Use one of: ${taskStates.join(", ")}.`],
  }),
});

type TaskContextResult =
  | {
      readonly ok: true;
      readonly root: string;
      readonly statePath: string;
      readonly taskPrefix: string;
    }
  | {
      readonly ok: false;
      readonly result: CliResult;
    };

const loadTaskContext = (cwd: string): TaskContextResult => {
  const context = loadTaskConfigContext(cwd);

  if (!context.ok) {
    return context;
  }

  if (!existsSync(context.statePath)) {
    return { ok: false, result: stateStoreUnavailable(context.taskPrefix) };
  }

  return context;
};

const loadTaskConfigContext = (cwd: string): TaskContextResult => {
  const gitRoot = findGitRoot(cwd);

  if (!gitRoot.ok) {
    return { ok: false, result: notInitialized() };
  }

  const root = gitRoot.root;
  const configPath = join(root, ".but-why/config.json");
  const statePath = join(root, ".but-why/state.sqlite");

  if (!existsSync(configPath)) {
    return { ok: false, result: notInitialized() };
  }

  const repoConfig = readRepoConfig(configPath);

  if (!repoConfig.ok || !taskPrefixPattern.test(repoConfig.config.taskPrefix)) {
    return {
      ok: false,
      result: runtimeError({
        code: "invalid_repo_config",
        message: ".but-why/config.json is not valid But Why? repo config.",
        details: { path: ".but-why/config.json" },
        help: ["Fix the JSON or run `by init --task-prefix <prefix>` after moving it aside."],
      }),
    };
  }

  return {
    ok: true,
    root,
    statePath,
    taskPrefix: repoConfig.config.taskPrefix,
  };
};

const taskHelpView = (): ToonObject => ({
  usage: "by task <command> [--help]",
  commands: [
    {
      command: "by task create --title <title> --description-file <file>",
      description: "Create a repo-local Task",
    },
    {
      command: "by task list [--all] [--state <state>]",
      description: "List repo-local Tasks",
    },
    {
      command: "by task show <task-id>",
      description: "Show compact Task metadata",
    },
    {
      command: "by task context <task-id>",
      description: "Show full Task Context",
    },
    {
      command: "by task comment <task-id> --file <file>",
      description: "Append a Markdown Task comment",
    },
  ],
});

const taskSummaryRows = (tasks: readonly TaskSummary[]): readonly ToonValue[] =>
  tasks.map((task) => ({
    id: task.id,
    title: task.title,
    state: task.state,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }));

const createTaskHelp =
  'Run `by task create --title "..." --description-file <file>` to create a task.';

const commentFileError = (error: CommentFileReadError): CliResult => {
  switch (error.code) {
    case "comment_file_not_found":
      return runtimeError({
        code: error.code,
        message: "Task comment file was not found.",
        details: { path: error.path },
        help: ["Create the file, then rerun `by task comment <task-id> --file <file>`."],
      });
    case "comment_file_unreadable":
      return runtimeError({
        code: error.code,
        message: "Task comment file is not readable UTF-8 text.",
        details: { path: error.path },
        help: ["Use a readable UTF-8 file for `--file`."],
      });
    case "empty_comment":
      return runtimeError({
        code: error.code,
        message: "Task comment must not be empty.",
        details: { path: error.path },
        help: ["Write a non-empty comment file and rerun the command."],
      });
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

const notInitialized = (): CliResult =>
  runtimeError({
    code: "not_initialized",
    message: "This workspace is not initialized for But Why?.",
    help: ["Run `by init --task-prefix BY` in the repository root."],
  });

const stateStoreUnavailable = (taskPrefix: string | undefined): CliResult =>
  runtimeError({
    code: "state_store_unavailable",
    message: "Repo-local But Why? state is unavailable.",
    help: [
      taskPrefix === undefined
        ? "Move or restore .but-why/state.sqlite, then run `by init --task-prefix <prefix>`."
        : `Move or restore .but-why/state.sqlite, then run \`by init --task-prefix ${taskPrefix}\`.`,
    ],
  });

const taskNotFound = (taskId: string): CliResult =>
  runtimeError({
    code: "task_not_found",
    message: `Task was not found: ${taskId}`,
    details: { taskId },
    help: ["Run `by task list --all` to see known Tasks."],
  });

const success = (stdout: ToonObject): CliResult => ({
  exitCode: 0,
  stdout,
});

const usageError = (input: ErrorInput): CliResult => ({
  exitCode: 2,
  stdout: errorView(input),
});

const runtimeError = (input: ErrorInput): CliResult => ({
  exitCode: 1,
  stdout: errorView(input),
});

type ErrorInput = {
  readonly code: string;
  readonly message: string;
  readonly details?: ToonObject;
  readonly help: readonly string[];
};

const errorView = (input: ErrorInput): ToonObject => ({
  error: {
    code: input.code,
    message: input.message,
    ...(input.details ?? {}),
  },
  help: input.help,
});
