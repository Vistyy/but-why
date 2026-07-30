import * as Args from "@effect/cli/Args";
import * as BuiltInOptions from "@effect/cli/BuiltInOptions";
import * as CliConfig from "@effect/cli/CliConfig";
import * as Command from "@effect/cli/Command";
import * as CommandDescriptor from "@effect/cli/CommandDescriptor";
import * as CommandDirective from "@effect/cli/CommandDirective";
import * as HelpDoc from "@effect/cli/HelpDoc";
import * as Options from "@effect/cli/Options";
import { NodeFileSystem, NodePath, NodeTerminal } from "@effect/platform-node";
import { Effect, Layer } from "effect";

import type { CliEnvironment } from "./cli.js";
import { success, usageError, type CliResult } from "./cliResults.js";
import type { OutputFormat } from "./output/structured.js";

const commandArguments = Args.repeated(Args.text()).pipe(
  Args.mapEffect((values) =>
    values.some((value) => value === "--output" || value === "-o")
      ? Effect.fail(HelpDoc.p("Global output options must appear before the command."))
      : Effect.succeed(values),
  ),
);
const globalOutput = Options.withAlias(
  Options.withDefault(Options.choice("output", ["toon", "json"]), "toon"),
  "o",
);

type AnyCommand = Command.Command<string, never, never, unknown>;
type Subcommands = readonly [AnyCommand, ...AnyCommand[]];
type SubcommandBuilder = <Name extends string, R, E, A>(
  self: Command.Command<Name, R, E, A>,
) => Command.Command<Name, R, E, A>;

const withSubcommands = (children: Subcommands): SubcommandBuilder =>
  (Command.withSubcommands as unknown as (children: Subcommands) => SubcommandBuilder)(children);

const leaf = (name: string, description: string): AnyCommand =>
  Command.make(name, { args: commandArguments }).pipe(
    Command.withDescription(description),
  ) as unknown as AnyCommand;

const group = (
  name: string,
  description: string,
  children: readonly AnyCommand[],
  acceptsArguments = false,
): AnyCommand =>
  Command.make(name, acceptsArguments ? { args: commandArguments } : {}).pipe(
    Command.withDescription(description),
    withSubcommands(children as Subcommands),
  ) as unknown as AnyCommand;

const taskCommand = group("task", "Manage repo-local Tasks.", [
  leaf("create", "Create a repo-local Task."),
  group("dependencies", "Manage direct Task prerequisites.", [
    leaf("set", "Replace direct Task prerequisites before Start."),
  ]),
  leaf("list", "List repo-local Tasks."),
  leaf("show", "Show decision-oriented Task metadata."),
  leaf("approve", "Permanently approve Task intent."),
  group(
    "context",
    "Show or edit Task Context.",
    [
      leaf("draft", "Create an editable Task Context draft."),
      leaf("apply", "Apply a Task Context draft."),
    ],
    true,
  ),
  leaf("comment", "Append a Markdown Task comment."),
  leaf("cancel", "Permanently cancel an unfinished Task."),
]);

const changeCommand = group("change", "Manage Changes and their Candidates.", [
  leaf("start", "Create a prepared Change worktree."),
  leaf("prepare", "Run or retry Repository Preparation."),
  leaf("list", "List Changes oldest first."),
  leaf("show", "Show decision-oriented Change state."),
  leaf("findings", "Show Findings for the current Change Candidate."),
  leaf("validation-runs", "List complete Validation Run history."),
  leaf("submit", "Validate and publish a ready Change."),
  leaf("cancel", "Cancel an open taskless Change."),
  leaf("reconcile", "Read owned pull requests and clean up terminal Changes."),
  leaf("implement", "Launch an Interactive Session in a ready Change worktree."),
  group("decision", "Manage Implementation Decisions.", [
    leaf("add", "Record one Implementer Implementation Decision."),
    leaf("list", "List the Change Implementation Decision Log."),
  ]),
  group("blocker", "Manage Implementation Blockers.", [
    leaf("raise", "Report an Implementation Blocker."),
    leaf("resolve", "Record an approved Implementation Blocker Resolution."),
    leaf("list", "List blocker and Resolution history."),
  ]),
]);

const validationRunCommand = group("validation-run", "Inspect Validation Runs and Artifacts.", [
  leaf("show", "Show Validation Run policy and recorded evidence."),
  leaf("artifact", "Show complete stored Artifact content."),
]);

const commandTree = Command.make("by", { output: globalOutput }).pipe(
  Command.withDescription("Validate completed code changes against approved human intent."),
  withSubcommands([
    leaf("init", "Create repo-local But Why? state."),
    taskCommand,
    changeCommand,
    validationRunCommand,
  ]),
);

const cliConfig = CliConfig.defaultConfig;
const parserLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, NodeTerminal.layer);

type CommandRouter = (
  args: readonly string[],
  environment: CliEnvironment,
) => Effect.Effect<CliResult>;

export const runCommandTree = (
  args: readonly string[],
  environment: CliEnvironment,
  routeCommandArgs: CommandRouter,
): Effect.Effect<CliResult> =>
  Effect.either(
    CommandDescriptor.parse(commandTree.descriptor, ["by", ...parserArgs(args)], cliConfig),
  ).pipe(
    Effect.flatMap((parsed) =>
      parsed._tag === "Left"
        ? Effect.succeed({
            ...usageError({
              code: "invalid_usage",
              message: generatedText(parsed.left.error),
              help: ["Run `by --help` for generated command help."],
            }),
            outputFormat: outputFormatFromLeadingArgs(args),
          })
        : directiveResult(parsed.right, args, environment, routeCommandArgs),
    ),
    Effect.provide(parserLayer),
  );

const directiveResult = (
  directive: CommandDirective.CommandDirective<unknown>,
  originalArgs: readonly string[],
  environment: CliEnvironment,
  routeCommandArgs: CommandRouter,
): Effect.Effect<CliResult> => {
  if (CommandDirective.isBuiltIn(directive)) {
    if (BuiltInOptions.isShowHelp(directive.option)) {
      return Effect.succeed({
        ...success({ help: rootHelpCorrection(generatedText(directive.option.helpDoc)) }),
        outputFormat: outputFormatFromLeadingArgs(originalArgs),
      });
    }
    return Effect.succeed(
      usageError({
        code: "invalid_usage",
        message: "Only command help is supported.",
        help: ["Run `by --help` for generated command help."],
      }),
    );
  }

  const command = commandValue(directive.value);
  const routeArgs = [...command.path.slice(1), ...command.args];

  return routeCommandArgs(routeArgs, environment).pipe(
    Effect.map((result) => ({
      ...normalizeUsageResult(result),
      outputFormat: command.output,
    })),
  );
};

type ParsedCommandValue = {
  readonly path: readonly string[];
  readonly args: readonly string[];
  readonly output: OutputFormat;
};

const commandValue = (value: unknown): ParsedCommandValue => {
  const path: string[] = ["by"];
  let current: unknown = value;
  let output: OutputFormat = "toon";
  let args: readonly string[] = [];

  while (isRecord(current)) {
    const parsedOutput = property(current, "output");
    if (parsedOutput === "toon" || parsedOutput === "json") output = parsedOutput;
    const parsedArgs = property(current, "args");
    if (Array.isArray(parsedArgs)) {
      args = parsedArgs.filter((item): item is string => typeof item === "string");
    }
    const subcommand = property(current, "subcommand");
    if (!isRecord(subcommand) || !Array.isArray(property(subcommand, "value"))) {
      break;
    }
    const subcommandValue = property(subcommand, "value");
    if (!Array.isArray(subcommandValue)) break;
    const key = subcommandValue[0];
    if (isRecord(key) && typeof property(key, "key") === "string") {
      const match = /\(([^()]*)\)$/u.exec(property(key, "key") as string);
      if (match?.[1] !== undefined) path.push(match[1]);
    }
    current = subcommandValue[1];
  }

  return { path, args, output };
};

const normalizeUsageResult = (result: CliResult): CliResult => {
  const error = property(result.stdout, "error");
  if (
    result.exitCode !== 2 ||
    !isRecord(error) ||
    (property(error, "code") !== "unknown_flag" && property(error, "code") !== "unknown_argument")
  ) {
    return result;
  }

  return {
    ...result,
    stdout: {
      ...result.stdout,
      error: {
        ...error,
        code: "invalid_usage",
      },
    },
  };
};

const parserArgs = (args: readonly string[]): readonly string[] =>
  args[0] === "--output" || args[0] === "-o"
    ? args[1] === "toon" || args[1] === "json"
      ? args[2] === "--help" || args[2] === "-h"
        ? args.slice(2)
        : args
      : args
    : args;

const outputFormatFromLeadingArgs = (args: readonly string[]): OutputFormat =>
  args[0] === "--output" || args[0] === "-o" ? (args[1] === "json" ? "json" : "toon") : "toon";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const property = (record: Record<string, unknown>, key: string): unknown => record[key];

const generatedText = (help: HelpDoc.HelpDoc): string => {
  const ansiEscape = String.fromCharCode(27);
  return HelpDoc.toAnsiText(help)
    .replaceAll(new RegExp(`${ansiEscape}\\[[0-9;]*m`, "gu"), "")
    .trim();
};

const rootHelpCorrection = (help: string): string =>
  help.replaceAll(/\b(task|change|validation-run) \1\b/gu, "$1");
