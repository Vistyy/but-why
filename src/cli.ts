import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { Effect, Schema } from "effect";

import { withGlobalHelpFlags } from "./cliHelp.js";
import { selectOutput } from "./cliOutputSelection.js";
import { runtimeError, success, type CliResult, usageError } from "./cliResults.js";
import { initRepoLocalContext } from "./init/repoContext.js";
import type { OutputFormat, StructuredObject } from "./output/structured.js";
import { routeSubmit } from "./submit/submitCli.js";
import { dashboard, routeTask } from "./task/taskCli.js";

export type { CliResult } from "./cliResults.js";

export type CliEnvironment = {
  readonly executablePath: string;
  readonly cwd: string;
  readonly now: () => Date;
};

const description = "Validate completed code changes against approved human intent.";

const helpViewSchema = Schema.Struct({
  bin: Schema.String,
  description: Schema.Literal(description),
  usage: Schema.Literal("by [--output <format>] [command] [--help]"),
  commands: Schema.Array(
    Schema.Struct({
      command: Schema.String,
      description: Schema.String,
    }),
  ),
  flags: Schema.Array(
    Schema.Struct({
      flag: Schema.String,
      description: Schema.String,
    }),
  ),
});

export const runCli = (
  args: readonly string[],
  environment: CliEnvironment,
): Effect.Effect<CliResult> => Effect.sync(() => routeArgs(args, environment));

export const routeArgs = (args: readonly string[], environment: CliEnvironment): CliResult => {
  const outputSelection = selectOutput(args);

  if (!outputSelection.ok) {
    return { ...outputSelection.result, outputFormat: "toon" };
  }

  const result = routeCommandArgs(outputSelection.args, environment);

  return { ...result, outputFormat: outputSelection.outputFormat };
};

const routeCommandArgs = (args: readonly string[], environment: CliEnvironment): CliResult => {
  const bin = collapseHome(environment.executablePath);

  if (args.length === 0) {
    return dashboard(bin, description, environment);
  }

  if (args.length === 1 && args[0] === "--help") {
    return success(helpView(bin));
  }

  const firstArg = args[0];

  if (firstArg === "init") {
    return routeInit(args.slice(1), environment);
  }

  if (firstArg === "task") {
    return routeTask(args.slice(1), environment);
  }

  if (firstArg === "submit") {
    return routeSubmit(args.slice(1), environment);
  }

  if (firstArg?.startsWith("-")) {
    return usageError({
      code: "unknown_flag",
      message: `Unknown flag: ${firstArg}`,
      help: ["Run `by --help`"],
    });
  }

  return usageError({
    code: "unknown_command",
    message: `Unknown command: ${firstArg ?? ""}`,
    help: ["Run `by --help`"],
  });
};

export const mapRuntimeError = (outputFormat: OutputFormat = "toon"): CliResult => ({
  ...runtimeError({
    code: "internal_error",
    message: "The command failed unexpectedly",
    help: ["Report this failure with the command and workspace path"],
  }),
  outputFormat,
});

export const collapseHome = (executablePath: string): string => {
  const absolutePath = resolve(executablePath);
  const homePath = homedir();

  if (absolutePath === homePath) {
    return "~";
  }

  if (absolutePath.startsWith(`${homePath}${sep}`)) {
    return `~${absolutePath.slice(homePath.length)}`;
  }

  return absolutePath;
};

const helpView = (bin: string): StructuredObject =>
  Schema.decodeUnknownSync(helpViewSchema)({
    bin,
    description,
    usage: "by [--output <format>] [command] [--help]",
    commands: [
      {
        command: "by",
        description: "Show workspace task dashboard",
      },
      {
        command: "by init --task-prefix <prefix>",
        description: "Create repo-local But Why? state",
      },
      {
        command: "by task create --title <title> --description-file <file>",
        description: "Create a repo-local Task",
      },
      {
        command: "by task list [--all] [--state <state>]",
        description: "List repo-local Tasks",
      },
      {
        command: "by submit <task-id>",
        description: "Create a Run from submit preflight",
      },
    ],
    flags: withGlobalHelpFlags(),
  });

const routeInit = (args: readonly string[], environment: CliEnvironment): CliResult => {
  if (args.length === 1 && args[0] === "--help") {
    return success({
      usage: "by init --task-prefix <prefix>",
      flags: withGlobalHelpFlags([
        {
          flag: "--task-prefix <prefix>",
          description: "Required task ID prefix such as BY",
        },
      ]),
      examples: ["by init --task-prefix BY"],
    });
  }

  const parseResult = parseInitArgs(args);

  if (!parseResult.ok) {
    return parseResult.result;
  }

  const taskPrefix = parseResult.taskPrefix;

  if (taskPrefix === undefined) {
    return usageError({
      code: "missing_task_prefix",
      message: "--task-prefix is required in non-interactive init.",
      help: ["Run by init --task-prefix BY."],
    });
  }

  const initResult = initRepoLocalContext({ cwd: environment.cwd, taskPrefix });

  if (!initResult.ok) {
    switch (initResult.error.code) {
      case "invalid_task_prefix":
        return usageError({
          code: "invalid_task_prefix",
          message: "Task prefix must match ^[A-Z][A-Z0-9]{1,9}$.",
          details: { taskPrefix: initResult.error.taskPrefix },
          help: ["Use 2 to 10 uppercase letters or digits, starting with a letter, such as BY."],
        });
      case "not_git_work_tree":
        return runtimeError({
          code: "not_git_work_tree",
          message: "by init must be run inside a Git work tree.",
          help: ["Run git init first, or cd into an existing Git repository."],
        });
      case "invalid_repo_config":
        return runtimeError({
          code: "invalid_repo_config",
          message: ".but-why/config.json is not valid But Why? repo config.",
          details: { path: ".but-why/config.json" },
          help: ["Fix the JSON or move the file aside before running init again."],
        });
      case "task_prefix_conflict":
        return runtimeError({
          code: "task_prefix_conflict",
          message: `Repository is already initialized with task prefix ${initResult.error.existingTaskPrefix}.`,
          details: {
            path: ".but-why/config.json",
            existingTaskPrefix: initResult.error.existingTaskPrefix,
            requestedTaskPrefix: initResult.error.requestedTaskPrefix,
          },
          help: [
            `Keep using ${initResult.error.existingTaskPrefix}, or manually migrate .but-why/config.json before running init again.`,
          ],
        });
      case "invalid_repo_state":
        return runtimeError({
          code: "invalid_repo_state",
          message: `${initResult.error.path} must be a ${initResult.error.expected}.`,
          details: { path: initResult.error.path },
          help: ["Move the conflicting path aside before running init again."],
        });
    }
  }

  return success({
    init: {
      status: initResult.status,
      root: initResult.root,
      taskPrefix: initResult.taskPrefix,
    },
    ...(initResult.created.length > 0 ? { created: initResult.created } : {}),
    ...(initResult.updated.length > 0 ? { updated: initResult.updated } : {}),
  });
};

type InitArgsParseResult =
  | {
      readonly ok: true;
      readonly taskPrefix: string | undefined;
    }
  | {
      readonly ok: false;
      readonly result: CliResult;
    };

const parseInitArgs = (args: readonly string[]): InitArgsParseResult => {
  let taskPrefix: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--task-prefix") {
      const value = args[index + 1];

      if (value === undefined || value.startsWith("-")) {
        return { ok: true, taskPrefix: undefined };
      }

      taskPrefix = value;
      index += 1;
      continue;
    }

    if (arg?.startsWith("-")) {
      return {
        ok: false,
        result: usageError({
          code: "unknown_flag",
          message: `Unknown flag: ${arg}`,
          help: ["Run `by init --task-prefix BY`"],
        }),
      };
    }

    return {
      ok: false,
      result: usageError({
        code: "unknown_argument",
        message: `Unknown argument: ${arg ?? ""}`,
        help: ["Run `by init --task-prefix BY`"],
      }),
    };
  }

  return { ok: true, taskPrefix };
};
