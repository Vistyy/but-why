import * as Args from "@effect/cli/Args";
import * as BuiltInOptions from "@effect/cli/BuiltInOptions";
import * as CliConfig from "@effect/cli/CliConfig";
import * as Command from "@effect/cli/Command";
import * as CommandDescriptor from "@effect/cli/CommandDescriptor";
import * as CommandDirective from "@effect/cli/CommandDirective";
import * as HelpDoc from "@effect/cli/HelpDoc";
import * as Options from "@effect/cli/Options";
import * as ValidationError from "@effect/cli/ValidationError";
import { NodeFileSystem, NodePath, NodeTerminal } from "@effect/platform-node";
import { Console, Effect, Layer } from "effect";

import type { CliEnvironment } from "./cli.js";
import { success, usageError, type CliResult } from "./cliResults.js";
import { runInitCommand } from "./cli/initCli.js";
import { runApproveCommand, type TaskIdCommand } from "./cli/task/commands/approve.js";
import { runCancelCommand } from "./cli/task/commands/cancel.js";
import { runCommentCommand } from "./cli/task/commands/comment.js";
import { runContextApplyCommand } from "./cli/task/commands/contextApply.js";
import { runContextCommand } from "./cli/task/commands/context.js";
import { runContextDraftCommand } from "./cli/task/commands/contextDraft.js";
import { runCreateCommand } from "./cli/task/commands/create.js";
import { runDependenciesCommand } from "./cli/task/commands/dependencies.js";
import { runListCommand } from "./cli/task/commands/list.js";
import { runTaskShowCommand } from "./cli/task/commands/show.js";
import {
  runBlocker,
  runCancel,
  runDecision,
  runFindings,
  runImplement,
  runList,
  runPrepare,
  runReconcile,
  runShow,
  runStart,
  runSubmit,
  runValidationRuns,
  type ChangeCommandEnvironment,
} from "./cli/change/changeCli.js";
import {
  runArtifactCommand,
  runShowCommand as runValidationRunShowCommand,
} from "./cli/validationRun/validationRunCli.js";
import { outputFormats, type OutputFormat } from "./output/structured.js";
import { taskStates, type TaskState } from "./task/lifecycle.js";

const globalOutput = Options.withAlias(
  Options.withDefault(Options.choice("output", outputFormats), "toon"),
  "o",
);

type AnyCommand = Command.Command<string, never, never, unknown>;
type Subcommands = readonly [AnyCommand, ...AnyCommand[]];
type CommandConfig = Record<string, Args.Args<unknown> | Options.Options<unknown>>;

type SubcommandBuilder = <Name extends string, R, E, A>(
  self: Command.Command<Name, R, E, A>,
) => Command.Command<Name, R, E, A>;

const withSubcommands = (children: Subcommands): SubcommandBuilder =>
  (Command.withSubcommands as unknown as (children: Subcommands) => SubcommandBuilder)(children);

const leaf = (name: string, description: string, config: CommandConfig = {}): AnyCommand =>
  Command.make(name, config).pipe(Command.withDescription(description)) as unknown as AnyCommand;

const group = (
  name: string,
  description: string,
  children: readonly AnyCommand[],
  config: CommandConfig = {},
): AnyCommand =>
  Command.make(name, config).pipe(
    Command.withDescription(description),
    withSubcommands(children as Subcommands),
  ) as unknown as AnyCommand;

const optionalText = (name: string) => Options.text(name).pipe(Options.optional);
const repeatedText = (name: string) => Options.repeated(Options.text(name));
const taskIdArgument = Args.text({ name: "task-id" });
const changeIdArgument = Args.text({ name: "change-id" });

const taskCommand = group("task", "Manage repo-local Tasks.", [
  leaf("create", "Create a repo-local Task.", {
    title: Options.text("title"),
    descriptionFile: Options.text("description-file"),
    dependsOn: repeatedText("depends-on"),
  }),
  group("dependencies", "Manage direct Task prerequisites.", [
    leaf("set", "Replace direct Task prerequisites before Start.", {
      taskId: taskIdArgument,
      dependsOn: repeatedText("depends-on"),
    }),
  ]),
  leaf("list", "List repo-local Tasks.", {
    all: Options.boolean("all"),
    state: Options.choice("state", taskStates).pipe(Options.optional),
  }),
  leaf("show", "Show decision-oriented Task metadata.", { taskId: taskIdArgument }),
  leaf("approve", "Permanently approve Task intent.", { taskId: taskIdArgument }),
  group(
    "context",
    "Show or edit Task Context.",
    [
      leaf("draft", "Create an editable Task Context draft.", { taskId: taskIdArgument }),
      leaf("apply", "Apply a Task Context draft.", { taskId: taskIdArgument }),
    ],
    { taskId: Args.optional(taskIdArgument) },
  ),
  leaf("comment", "Append a Markdown Task comment.", {
    taskId: taskIdArgument,
    file: Options.text("file"),
  }),
  leaf("cancel", "Permanently cancel an unfinished Task.", {
    taskId: taskIdArgument,
    reason: Options.text("reason"),
  }),
]);

const changeCommand = group("change", "Manage Changes and their Candidates.", [
  leaf("start", "Create a prepared Change worktree.", {
    task: optionalText("task"),
    base: optionalText("base"),
  }),
  leaf("prepare", "Run or retry Repository Preparation.", { changeId: changeIdArgument }),
  leaf("list", "List Changes oldest first.", { all: Options.boolean("all") }),
  leaf("show", "Show decision-oriented Change state.", { changeId: changeIdArgument }),
  leaf("findings", "Show Findings for the current Change Candidate.", {
    changeId: changeIdArgument,
  }),
  leaf("validation-runs", "List complete Validation Run history.", {
    changeId: changeIdArgument,
  }),
  leaf("submit", "Validate and publish a ready Change.", { changeId: changeIdArgument }),
  leaf("cancel", "Cancel an open taskless Change.", { changeId: changeIdArgument }),
  leaf("reconcile", "Read owned pull requests and clean up terminal Changes.", {
    changeId: Args.optional(changeIdArgument),
  }),
  leaf("implement", "Launch an Interactive Session in a ready Change worktree.", {
    changeId: changeIdArgument,
    handoffFile: optionalText("handoff-file"),
  }),
  group("decision", "Manage Implementation Decisions.", [
    leaf("add", "Record one Implementer Implementation Decision.", {
      changeId: changeIdArgument,
      file: Options.text("file"),
    }),
    leaf("list", "List the Change Implementation Decision Log.", {
      changeId: changeIdArgument,
    }),
  ]),
  group("blocker", "Manage Implementation Blockers.", [
    leaf("raise", "Report an Implementation Blocker.", {
      changeId: changeIdArgument,
      file: Options.text("file"),
    }),
    leaf("resolve", "Record an approved Implementation Blocker Resolution.", {
      changeId: changeIdArgument,
      file: Options.text("file"),
    }),
    leaf("list", "List blocker and Resolution history.", { changeId: changeIdArgument }),
  ]),
]);

const validationRunCommand = group("validation-run", "Inspect Validation Runs and Artifacts.", [
  leaf("show", "Show Validation Run policy and recorded evidence.", {
    validationRunId: Args.text({ name: "validation-run-id" }),
  }),
  leaf("artifact", "Show complete stored Artifact content.", {
    validationRunId: Args.text({ name: "validation-run-id" }),
    artifactRef: Args.text({ name: "artifact-ref" }),
  }),
]);

const commandTree = Command.make("by", { output: globalOutput }).pipe(
  Command.withDescription("Validate completed code changes against approved human intent."),
  withSubcommands([
    leaf("init", "Create repo-local But Why? state.", {
      taskPrefix: Options.text("task-prefix"),
    }),
    taskCommand,
    changeCommand,
    validationRunCommand,
  ]),
);

const cliConfig = CliConfig.defaultConfig;
const parserLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, NodeTerminal.layer);

export const runCommandTree = (
  args: readonly string[],
  environment: CliEnvironment,
): Effect.Effect<CliResult> =>
  trailingOutputUsage(args) ??
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
        : directiveResult(parsed.right, args, environment),
    ),
    Effect.provide(parserLayer),
  );

const directiveResult = (
  directive: CommandDirective.CommandDirective<unknown>,
  originalArgs: readonly string[],
  environment: CliEnvironment,
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

  if (directive.leftover.length > 0) {
    return generatedLeftoverUsage(originalArgs);
  }

  const command = commandValue(directive.value);
  return dispatchCommand(command.path, command.config, environment).pipe(
    Effect.map((result) => ({ ...result, outputFormat: command.output })),
  );
};

type ParsedCommandValue = {
  readonly path: readonly string[];
  readonly config: unknown;
  readonly output: OutputFormat;
};

const commandValue = (value: unknown): ParsedCommandValue => {
  const path: string[] = ["by"];
  let current: unknown = value;
  let output: OutputFormat = "toon";

  while (isRecord(current)) {
    const parsedOutput = property(current, "output");
    if (parsedOutput === "toon" || parsedOutput === "json") output = parsedOutput;
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

  return { path, config: current, output };
};

const dispatchCommand = (
  path: readonly string[],
  config: unknown,
  environment: CliEnvironment,
): Effect.Effect<CliResult> => {
  const values = isRecord(config) ? config : {};
  const command = path.slice(1).join(" ");

  switch (command) {
    case "init":
      return runInitCommand({ taskPrefix: requiredString(values, "taskPrefix") }, environment);
    case "task create":
      return runCreateCommand(
        {
          title: requiredString(values, "title"),
          descriptionFile: requiredString(values, "descriptionFile"),
          dependsOn: strings(values, "dependsOn"),
        },
        environment,
      );
    case "task dependencies set":
      return runDependenciesCommand(
        {
          taskId: requiredString(values, "taskId"),
          dependsOn: strings(values, "dependsOn"),
        },
        environment,
      );
    case "task list":
      return runListCommand(
        {
          all: boolean(values, "all"),
          state: optionalString(values, "state") as TaskState | undefined,
        },
        environment,
      );
    case "task show":
      return runTaskShowCommand(taskId(values), environment);
    case "task approve":
      return runApproveCommand(taskId(values), environment);
    case "task context": {
      const taskId = optionalString(values, "taskId");
      return taskId === undefined
        ? invalidUsage("A Task ID is required for `by task context`.")
        : runContextCommand({ taskId }, environment);
    }
    case "task context draft":
      return runContextDraftCommand(taskId(values), environment);
    case "task context apply":
      return runContextApplyCommand(taskId(values), environment);
    case "task comment":
      return runCommentCommand(
        { taskId: requiredString(values, "taskId"), file: requiredString(values, "file") },
        environment,
      );
    case "task cancel":
      return runCancelCommand(
        { taskId: requiredString(values, "taskId"), reason: requiredString(values, "reason") },
        environment,
      );
    case "change start":
      return runStart(
        {
          taskId: optionalString(values, "task"),
          baseBranch: optionalString(values, "base"),
        },
        environment as ChangeCommandEnvironment,
      );
    case "change prepare":
      return runPrepare(changeId(values), environment as ChangeCommandEnvironment);
    case "change list":
      return runList({ all: boolean(values, "all") }, environment as ChangeCommandEnvironment);
    case "change show":
      return runShow(changeId(values), environment as ChangeCommandEnvironment);
    case "change findings":
      return runFindings(changeId(values), environment as ChangeCommandEnvironment);
    case "change validation-runs":
      return runValidationRuns(changeId(values), environment as ChangeCommandEnvironment);
    case "change submit":
      return runSubmit(changeId(values), environment as ChangeCommandEnvironment);
    case "change cancel":
      return runCancel(changeId(values), environment as ChangeCommandEnvironment);
    case "change reconcile":
      return runReconcile(
        { changeId: optionalString(values, "changeId") },
        environment as ChangeCommandEnvironment,
      );
    case "change implement":
      return runImplement(
        {
          changeId: requiredString(values, "changeId"),
          handoffFile: optionalString(values, "handoffFile"),
        },
        environment as ChangeCommandEnvironment,
      );
    case "change decision add":
      return runDecision(
        {
          action: "add",
          changeId: requiredString(values, "changeId"),
          file: requiredString(values, "file"),
        },
        environment as ChangeCommandEnvironment,
      );
    case "change decision list":
      return runDecision(
        { action: "list", changeId: requiredString(values, "changeId") },
        environment as ChangeCommandEnvironment,
      );
    case "change blocker raise":
    case "change blocker resolve":
      return runBlocker(
        {
          action: path.at(-1) as "raise" | "resolve",
          changeId: requiredString(values, "changeId"),
          file: requiredString(values, "file"),
        },
        environment as ChangeCommandEnvironment,
      );
    case "change blocker list":
      return runBlocker(
        { action: "list", changeId: requiredString(values, "changeId") },
        environment as ChangeCommandEnvironment,
      );
    case "validation-run show":
      return runValidationRunShowCommand(
        { validationRunId: requiredString(values, "validationRunId") },
        environment,
      );
    case "validation-run artifact":
      return runArtifactCommand(
        {
          validationRunId: requiredString(values, "validationRunId"),
          artifactRef: requiredString(values, "artifactRef"),
        },
        environment,
      );
    default:
      return invalidUsage(`Unknown command: ${command}`);
  }
};

const taskId = (values: Record<string, unknown>): TaskIdCommand => ({
  taskId: requiredString(values, "taskId"),
});

const changeId = (values: Record<string, unknown>): { readonly changeId: string } => ({
  changeId: requiredString(values, "changeId"),
});

const requiredString = (values: Record<string, unknown>, key: string): string => {
  const value = optionalValue(property(values, key));
  return typeof value === "string" ? value : "";
};

const optionalString = (values: Record<string, unknown>, key: string): string | undefined => {
  const value = optionalValue(property(values, key));
  return typeof value === "string" ? value : undefined;
};

const strings = (values: Record<string, unknown>, key: string): readonly string[] => {
  const value = property(values, key);
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
};

const boolean = (values: Record<string, unknown>, key: string): boolean =>
  property(values, key) === true;

const optionalValue = (value: unknown): unknown => {
  if (!isRecord(value)) return value;
  return property(value, "_tag") === "Some" ? property(value, "value") : undefined;
};

const invalidUsage = (message: string): Effect.Effect<CliResult> =>
  Effect.succeed(
    usageError({
      code: "invalid_usage",
      message,
      help: ["Run `by --help` for generated command help."],
    }),
  );

const trailingOutputUsage = (args: readonly string[]): Effect.Effect<CliResult> | undefined => {
  const outputIndex = args.findIndex(
    (arg, index) =>
      index > 1 &&
      (arg === "--output" || arg === "-o" || arg.startsWith("--output=") || arg.startsWith("-o=")),
  );
  if (outputIndex === -1) return undefined;
  return Effect.succeed({
    ...usageError({
      code: "invalid_usage",
      message: "Global output options must appear before the command.",
      help: ["Run `by --help` for generated command help."],
    }),
    outputFormat: outputFormatFromLeadingArgs(args),
  });
};

const parserArgs = (args: readonly string[]): readonly string[] =>
  args[0] === "--output" || args[0] === "-o"
    ? args[1] === "toon" || args[1] === "json"
      ? args[2] === "--help" || args[2] === "-h"
        ? args.slice(2)
        : args
      : args
    : args;

const generatedLeftoverUsage = (args: readonly string[]): Effect.Effect<CliResult> =>
  Effect.either(
    Console.consoleWith((console) =>
      Console.withConsole({
        ...console,
        error: () => Effect.void,
      })(
        Command.run(commandTree, { executable: "by", name: "by", version: "0.0.0" })([
          "by",
          "by",
          ...parserArgs(args),
        ]).pipe(Effect.provide(parserLayer)),
      ),
    ),
  ).pipe(
    Effect.map((result) => {
      const message =
        result._tag === "Left" && ValidationError.isValidationError(result.left)
          ? generatedText(result.left.error)
          : "Invalid command syntax.";
      return {
        ...usageError({
          code: "invalid_usage",
          message,
          help: ["Run `by --help` for generated command help."],
        }),
        outputFormat: outputFormatFromLeadingArgs(args),
      };
    }),
  );

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
  help
    .replaceAll(/\b(task|change|validation-run) \1\b/gu, "$1")
    .replaceAll(/\[<task-id>\] (?=(draft|apply) <task-id>)/gu, "");
