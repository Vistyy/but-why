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
import { Console, Context, Effect, Layer } from "effect";

import type { CliEnvironment } from "./cli.js";
import { collapseHome } from "./cli/cliPath.js";
import { dashboard } from "./cli/task/dashboard.js";
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

class RawCliArgs extends Context.Tag("@but-why/RawCliArgs")<RawCliArgs, readonly string[]>() {}

const globalOutput = Options.withAlias(
  Options.withDefault(
    Options.choice("output", outputFormats).pipe(
      Options.mapEffect(
        (value) =>
          Effect.contextWithEffect((context) =>
            hasTrailingOutput(Context.get(context, RawCliArgs))
              ? Effect.fail(
                  ValidationError.invalidValue(
                    HelpDoc.p("Global output options must appear before the command."),
                  ),
                )
              : Effect.succeed(value),
          ) as unknown as Effect.Effect<OutputFormat, ValidationError.ValidationError, never>,
      ),
    ),
    "toon",
  ),
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

const taskDependenciesCommand = group("dependencies", "Manage direct Task prerequisites.", [
  leaf("set", "Replace direct Task prerequisites before Start.", {
    taskId: taskIdArgument,
    dependsOn: repeatedText("depends-on"),
  }),
]);

const taskContextCommand = group(
  "context",
  "Show or edit Task Context.",
  [
    leaf("draft", "Create an editable Task Context draft.", { taskId: taskIdArgument }),
    leaf("apply", "Apply a Task Context draft.", { taskId: taskIdArgument }),
  ],
  { taskId: Args.optional(taskIdArgument) },
);

const taskCommand = group("task", "Manage repo-local Tasks.", [
  leaf("create", "Create a repo-local Task.", {
    title: Options.text("title"),
    descriptionFile: Options.text("description-file"),
    dependsOn: repeatedText("depends-on"),
  }),
  taskDependenciesCommand,
  leaf("list", "List repo-local Tasks.", {
    all: Options.boolean("all"),
    state: Options.choice("state", taskStates).pipe(Options.optional),
  }),
  leaf("show", "Show decision-oriented Task metadata.", { taskId: taskIdArgument }),
  leaf("approve", "Permanently approve Task intent.", { taskId: taskIdArgument }),
  taskContextCommand,
  leaf("comment", "Append a Markdown Task comment.", {
    taskId: taskIdArgument,
    file: Options.text("file"),
  }),
  leaf("cancel", "Permanently cancel an unfinished Task.", {
    taskId: taskIdArgument,
    reason: Options.text("reason"),
  }),
]);

const changeDecisionCommand = group("decision", "Manage Implementation Decisions.", [
  leaf("add", "Record one Implementer Implementation Decision.", {
    changeId: changeIdArgument,
    file: Options.text("file"),
  }),
  leaf("list", "List the Change Implementation Decision Log.", {
    changeId: changeIdArgument,
  }),
]);

const changeBlockerCommand = group("blocker", "Manage Implementation Blockers.", [
  leaf("raise", "Report an Implementation Blocker.", {
    changeId: changeIdArgument,
    file: Options.text("file"),
  }),
  leaf("resolve", "Record an approved Implementation Blocker Resolution.", {
    changeId: changeIdArgument,
    file: Options.text("file"),
  }),
  leaf("list", "List blocker and Resolution history.", { changeId: changeIdArgument }),
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
  changeDecisionCommand,
  changeBlockerCommand,
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

const cliConfig = CliConfig.make({ showBuiltIns: false });
const parserLayer = (args: readonly string[]) =>
  Layer.mergeAll(
    NodeFileSystem.layer,
    NodePath.layer,
    NodeTerminal.layer,
    Layer.succeed(RawCliArgs, args),
  );

export const runCommandTree = (
  args: readonly string[],
  environment: CliEnvironment,
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
            outputFormat: outputFormatForArgs(args),
          })
        : directiveResult(parsed.right, args, environment),
    ),
    Effect.provide(parserLayer(args)),
  );

const directiveResult = (
  directive: CommandDirective.CommandDirective<unknown>,
  originalArgs: readonly string[],
  environment: CliEnvironment,
): Effect.Effect<CliResult> => {
  if (CommandDirective.isBuiltIn(directive)) {
    if (BuiltInOptions.isShowHelp(directive.option)) {
      return originalArgs.length === 0
        ? dashboardResult(environment, "toon")
        : Effect.succeed({
            ...success({ help: rootHelpCorrection(generatedText(directive.option.helpDoc)) }),
            outputFormat: outputFormatForArgs(originalArgs),
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
  return command.path.length === 1
    ? dashboardResult(environment, command.output)
    : dispatchCommand(command.path, command.config, environment).pipe(
        Effect.map((result) => ({ ...result, outputFormat: command.output })),
      );
};

const dashboardResult = (
  environment: CliEnvironment,
  outputFormat: OutputFormat,
): Effect.Effect<CliResult> =>
  dashboard(
    collapseHome(environment.executablePath),
    "Validate completed code changes against approved human intent.",
    environment,
  ).pipe(Effect.map((result) => ({ ...result, outputFormat })));

type CommandPath =
  | "init"
  | "task"
  | "task create"
  | "task dependencies"
  | "task dependencies set"
  | "task list"
  | "task show"
  | "task approve"
  | "task context"
  | "task context draft"
  | "task context apply"
  | "task comment"
  | "task cancel"
  | "change"
  | "change start"
  | "change prepare"
  | "change list"
  | "change show"
  | "change findings"
  | "change validation-runs"
  | "change submit"
  | "change cancel"
  | "change reconcile"
  | "change implement"
  | "change decision"
  | "change decision add"
  | "change decision list"
  | "change blocker"
  | "change blocker raise"
  | "change blocker resolve"
  | "change blocker list"
  | "validation-run"
  | "validation-run show"
  | "validation-run artifact";

const commandPath = (path: readonly string[]): CommandPath =>
  path.slice(1).join(" ") as CommandPath;

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

type CommandHandler = (
  values: Record<string, unknown>,
  environment: CliEnvironment,
) => Effect.Effect<CliResult>;

const commandHandlers: Record<CommandPath, CommandHandler> = {
  init: (values, environment) =>
    runInitCommand({ taskPrefix: requiredString(values, "taskPrefix") }, environment),
  task: () => generatedCommandUsage(taskCommand),
  "task dependencies": () => generatedCommandUsage(taskDependenciesCommand),
  "task create": (values, environment) =>
    runCreateCommand(
      {
        title: requiredString(values, "title"),
        descriptionFile: requiredString(values, "descriptionFile"),
        dependsOn: strings(values, "dependsOn"),
      },
      environment,
    ),
  "task dependencies set": (values, environment) =>
    runDependenciesCommand(
      {
        taskId: requiredString(values, "taskId"),
        dependsOn: strings(values, "dependsOn"),
      },
      environment,
    ),
  "task list": (values, environment) =>
    runListCommand(
      {
        all: boolean(values, "all"),
        state: optionalString(values, "state") as TaskState | undefined,
      },
      environment,
    ),
  "task show": (values, environment) => runTaskShowCommand(taskId(values), environment),
  "task approve": (values, environment) => runApproveCommand(taskId(values), environment),
  "task context": (values, environment) => {
    const taskId = optionalString(values, "taskId");
    return taskId === undefined
      ? generatedCommandUsage(taskContextCommand)
      : runContextCommand({ taskId }, environment);
  },
  "task context draft": (values, environment) =>
    runContextDraftCommand(taskId(values), environment),
  "task context apply": (values, environment) =>
    runContextApplyCommand(taskId(values), environment),
  "task comment": (values, environment) =>
    runCommentCommand(
      { taskId: requiredString(values, "taskId"), file: requiredString(values, "file") },
      environment,
    ),
  "task cancel": (values, environment) =>
    runCancelCommand(
      { taskId: requiredString(values, "taskId"), reason: requiredString(values, "reason") },
      environment,
    ),
  change: () => generatedCommandUsage(changeCommand),
  "change decision": () => generatedCommandUsage(changeDecisionCommand),
  "change blocker": () => generatedCommandUsage(changeBlockerCommand),
  "change start": (values, environment) =>
    runStart(
      {
        taskId: optionalString(values, "task"),
        baseBranch: optionalString(values, "base"),
      },
      environment as ChangeCommandEnvironment,
    ),
  "change prepare": (values, environment) =>
    runPrepare(changeId(values), environment as ChangeCommandEnvironment),
  "change list": (values, environment) =>
    runList({ all: boolean(values, "all") }, environment as ChangeCommandEnvironment),
  "change show": (values, environment) =>
    runShow(changeId(values), environment as ChangeCommandEnvironment),
  "change findings": (values, environment) =>
    runFindings(changeId(values), environment as ChangeCommandEnvironment),
  "change validation-runs": (values, environment) =>
    runValidationRuns(changeId(values), environment as ChangeCommandEnvironment),
  "change submit": (values, environment) =>
    runSubmit(changeId(values), environment as ChangeCommandEnvironment),
  "change cancel": (values, environment) =>
    runCancel(changeId(values), environment as ChangeCommandEnvironment),
  "change reconcile": (values, environment) =>
    runReconcile(
      { changeId: optionalString(values, "changeId") },
      environment as ChangeCommandEnvironment,
    ),
  "change implement": (values, environment) =>
    runImplement(
      {
        changeId: requiredString(values, "changeId"),
        handoffFile: optionalString(values, "handoffFile"),
      },
      environment as ChangeCommandEnvironment,
    ),
  "change decision add": (values, environment) =>
    runDecision(
      {
        action: "add",
        changeId: requiredString(values, "changeId"),
        file: requiredString(values, "file"),
      },
      environment as ChangeCommandEnvironment,
    ),
  "change decision list": (values, environment) =>
    runDecision(
      { action: "list", changeId: requiredString(values, "changeId") },
      environment as ChangeCommandEnvironment,
    ),
  "change blocker raise": (values, environment) =>
    runBlocker(
      {
        action: "raise",
        changeId: requiredString(values, "changeId"),
        file: requiredString(values, "file"),
      },
      environment as ChangeCommandEnvironment,
    ),
  "change blocker resolve": (values, environment) =>
    runBlocker(
      {
        action: "resolve",
        changeId: requiredString(values, "changeId"),
        file: requiredString(values, "file"),
      },
      environment as ChangeCommandEnvironment,
    ),
  "change blocker list": (values, environment) =>
    runBlocker(
      { action: "list", changeId: requiredString(values, "changeId") },
      environment as ChangeCommandEnvironment,
    ),
  "validation-run": () => generatedCommandUsage(validationRunCommand),
  "validation-run show": (values, environment) =>
    runValidationRunShowCommand(
      { validationRunId: requiredString(values, "validationRunId") },
      environment,
    ),
  "validation-run artifact": (values, environment) =>
    runArtifactCommand(
      {
        validationRunId: requiredString(values, "validationRunId"),
        artifactRef: requiredString(values, "artifactRef"),
      },
      environment,
    ),
};

const dispatchCommand = (
  path: readonly string[],
  config: unknown,
  environment: CliEnvironment,
): Effect.Effect<CliResult> => {
  const handler = commandHandlers[commandPath(path)];
  return handler === undefined
    ? generatedCommandUsage(commandTree as unknown as AnyCommand)
    : handler(isRecord(config) ? config : {}, environment);
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

const generatedCommandUsage = (command: AnyCommand): Effect.Effect<CliResult> =>
  Effect.succeed(
    usageError({
      code: "invalid_usage",
      message: rootHelpCorrection(generatedText(Command.getHelp(command, cliConfig))),
      help: ["Run `by --help` for generated command help."],
    }),
  );

const hasTrailingOutput = (args: readonly string[]): boolean =>
  args.some(
    (arg, index) =>
      index > 0 &&
      (arg === "--output" || arg === "-o" || arg.startsWith("--output=") || arg.startsWith("-o=")),
  );

const parserArgs = (args: readonly string[]): readonly string[] => {
  const parsedArgs =
    args[0] === "--output" || args[0] === "-o"
      ? args[1] === "toon" || args[1] === "json"
        ? args[2] === "--help" || args[2] === "-h"
          ? args.slice(2)
          : args
        : args
      : args;
  return hasTrailingOutput(args) && parsedArgs.some((arg) => arg === "--help" || arg === "-h")
    ? parsedArgs.filter((arg) => arg !== "--help" && arg !== "-h")
    : parsedArgs;
};

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
        ]).pipe(Effect.provide(parserLayer(args))),
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
        outputFormat: outputFormatForArgs(args),
      };
    }),
  );

export const outputFormatForArgs = (args: readonly string[]): OutputFormat => {
  const selector = args[0];
  if (selector === "--output" || selector === "-o") {
    return args[1] === "json" ? "json" : "toon";
  }
  return selector?.startsWith("--output=") || selector?.startsWith("-o=")
    ? selector.split("=", 2)[1] === "json"
      ? "json"
      : "toon"
    : "toon";
};

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
