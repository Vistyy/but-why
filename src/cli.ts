import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { Effect, Schema } from "effect";

import type { ToonObject } from "./output/toon.js";

export type CliResult = {
  readonly exitCode: 0 | 1 | 2;
  readonly stdout: ToonObject;
};

export type CliEnvironment = {
  readonly executablePath: string;
};

const description = "Manage But Why? tasks in this workspace";

const homeViewSchema = Schema.Struct({
  bin: Schema.String,
  description: Schema.Literal(description),
  initialized: Schema.Boolean,
  tasks: Schema.String,
  help: Schema.Array(Schema.String),
});

const helpViewSchema = Schema.Struct({
  bin: Schema.String,
  description: Schema.Literal(description),
  usage: Schema.Literal("by [--help]"),
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

const errorViewSchema = Schema.Struct({
  error: Schema.Struct({
    code: Schema.String,
    message: Schema.String,
  }),
  help: Schema.Array(Schema.String),
});

export const runCli = (
  args: readonly string[],
  environment: CliEnvironment,
): Effect.Effect<CliResult> =>
  Effect.sync(() => routeArgs(args, collapseHome(environment.executablePath)));

export const routeArgs = (args: readonly string[], bin: string): CliResult => {
  if (args.length === 0) {
    return success(homeView(bin));
  }

  if (args.length === 1 && args[0] === "--help") {
    return success(helpView(bin));
  }

  const firstArg = args[0];

  if (firstArg?.startsWith("-")) {
    return usageError({
      code: "unknown_flag",
      message: `Unknown flag: ${firstArg}`,
      help: "Run `by --help`",
    });
  }

  return usageError({
    code: "unknown_command",
    message: `Unknown command: ${firstArg ?? ""}`,
    help: "Run `by --help`",
  });
};

export const mapRuntimeError = (): CliResult => ({
  exitCode: 1,
  stdout: Schema.decodeUnknownSync(errorViewSchema)({
    error: {
      code: "internal_error",
      message: "The command failed unexpectedly",
    },
    help: ["Report this failure with the command and workspace path"],
  }),
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

const homeView = (bin: string): ToonObject =>
  Schema.decodeUnknownSync(homeViewSchema)({
    bin,
    description,
    initialized: false,
    tasks: "0 tasks found because this workspace is not initialized",
    help: ["Run `by init` to create repo-local But Why? state"],
  });

const helpView = (bin: string): ToonObject =>
  Schema.decodeUnknownSync(helpViewSchema)({
    bin,
    description,
    usage: "by [--help]",
    commands: [
      {
        command: "by",
        description: "Show workspace task dashboard",
      },
    ],
    flags: [
      {
        flag: "--help",
        description: "Show this help",
      },
    ],
  });

const success = (stdout: ToonObject): CliResult => ({
  exitCode: 0,
  stdout,
});

const usageError = (input: {
  readonly code: string;
  readonly message: string;
  readonly help: string;
}): CliResult => ({
  exitCode: 2,
  stdout: Schema.decodeUnknownSync(errorViewSchema)({
    error: {
      code: input.code,
      message: input.message,
    },
    help: [input.help],
  }),
});
