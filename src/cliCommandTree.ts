import * as Args from "@effect/cli/Args";
import * as CliConfig from "@effect/cli/CliConfig";
import * as Command from "@effect/cli/Command";
import * as HelpDoc from "@effect/cli/HelpDoc";
import * as Options from "@effect/cli/Options";
import * as ValidationError from "@effect/cli/ValidationError";
import { NodeFileSystem, NodePath, NodeTerminal } from "@effect/platform-node";
import { createRequire } from "node:module";
import { Console, Context, Effect, Layer, Logger, Ref } from "effect";

import type { CliEnvironment } from "./cli.js";
import { collapseHome } from "./cli/cliPath.js";
import { dashboard } from "./cli/task/dashboard.js";
import { success, usageError, type CliResult } from "./cliResults.js";
import { runInitCommand } from "./cli/initCli.js";
import { runApproveCommand } from "./cli/task/commands/approve.js";
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
  runCancel as runChangeCancel,
  runDecision,
  runFindings,
  runImplement,
  runList as runChangeList,
  runPrepare,
  runReconcile,
  runShow as runChangeShow,
  runStart,
  runSubmit,
  runValidationRuns,
  type ChangeCommandEnvironment,
} from "./cli/change/changeCli.js";
import {
  runAbandonCommand,
  runArtifactCommand,
  runShowCommand as runValidationRunShowCommand,
} from "./cli/validationRun/validationRunCli.js";
import { outputFormats, type OutputFormat } from "./output/structured.js";
import { taskStates, type TaskState } from "./task/lifecycle.js";

class CliEnvironmentContext extends Context.Tag("@but-why/CliEnvironment")<
  CliEnvironmentContext,
  CliEnvironment
>() {}

class CliResultSink extends Context.Tag("@but-why/CliResultSink")<
  CliResultSink,
  (result: CliResult) => Effect.Effect<void>
>() {}

type AnyCommand = Command.Command<string, never, never, unknown>;
type Subcommands = readonly [AnyCommand, ...AnyCommand[]];
type CommandConfig = Record<string, Args.Args<unknown> | Options.Options<unknown>>;
type CliOperation = (
  values: Record<string, unknown>,
  environment: CliEnvironment,
) => Effect.Effect<CliResult>;

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
  operation?: CliOperation,
): AnyCommand => {
  const base = Command.make(name, config).pipe(
    Command.withDescription(description),
  ) as unknown as AnyCommand;
  const handled = operation === undefined ? base : withCliHandler(base, operation);
  return handled.pipe(withSubcommands(children as Subcommands)) as unknown as AnyCommand;
};

const withCliHandler = (command: AnyCommand, operation: CliOperation): AnyCommand =>
  Command.withHandler(command, (value: unknown) =>
    Effect.contextWithEffect((context) =>
      operation(isRecord(value) ? value : {}, Context.get(context, CliEnvironmentContext)).pipe(
        Effect.flatMap((result) => Context.get(context, CliResultSink)(result)),
      ),
    ),
  ) as unknown as AnyCommand;

const optionalText = (name: string) => Options.text(name).pipe(Options.optional);
const repeatedText = (name: string) => Options.repeated(Options.text(name));
const taskIdArgument = Args.text({ name: "task-id" });
const changeIdArgument = Args.text({ name: "change-id" });

const taskDependenciesSetCommand = withCliHandler(
  leaf("set", "Replace direct Task prerequisites before Start.", {
    taskId: taskIdArgument,
    dependsOn: repeatedText("depends-on"),
  }),
  (values, environment) =>
    runDependenciesCommand(
      {
        taskId: requiredString(values, "taskId"),
        dependsOn: strings(values, "dependsOn"),
      },
      environment,
    ),
);

let taskDependenciesCommand: AnyCommand;
taskDependenciesCommand = group(
  "dependencies",
  "Manage direct Task prerequisites.",
  [taskDependenciesSetCommand],
  {},
  () => generatedCommandUsage(taskDependenciesCommand),
);

const taskContextDraftCommand = withCliHandler(
  leaf("draft", "Create an editable Task Context draft.", { taskId: taskIdArgument }),
  (values, environment) => runContextDraftCommand(taskId(values), environment),
);
const taskContextApplyCommand = withCliHandler(
  leaf("apply", "Apply a Task Context draft.", { taskId: taskIdArgument }),
  (values, environment) => runContextApplyCommand(taskId(values), environment),
);
let taskContextCommand: AnyCommand;
taskContextCommand = group(
  "context",
  "Show or edit Task Context.",
  [taskContextDraftCommand, taskContextApplyCommand],
  { taskId: Args.optional(taskIdArgument) },
  (values, environment) => {
    const taskId = optionalString(values, "taskId");
    return taskId === undefined
      ? generatedCommandUsage(taskContextCommand)
      : runContextCommand({ taskId }, environment);
  },
);

const taskCreateCommand = withCliHandler(
  leaf("create", "Create a repo-local Task.", {
    title: Options.text("title"),
    descriptionFile: Options.text("description-file"),
    dependsOn: repeatedText("depends-on"),
  }),
  (values, environment) =>
    runCreateCommand(
      {
        title: requiredString(values, "title"),
        descriptionFile: requiredString(values, "descriptionFile"),
        dependsOn: strings(values, "dependsOn"),
      },
      environment,
    ),
);
const taskListCommand = withCliHandler(
  leaf("list", "List repo-local Tasks.", {
    all: Options.boolean("all"),
    state: Options.choice("state", taskStates).pipe(Options.optional),
  }),
  (values, environment) =>
    runListCommand(
      {
        all: boolean(values, "all"),
        state: optionalString(values, "state") as TaskState | undefined,
      },
      environment,
    ),
);
const taskShowCommand = withCliHandler(
  leaf("show", "Show decision-oriented Task metadata.", { taskId: taskIdArgument }),
  (values, environment) => runTaskShowCommand(taskId(values), environment),
);
const taskApproveCommand = withCliHandler(
  leaf("approve", "Permanently approve Task intent.", { taskId: taskIdArgument }),
  (values, environment) => runApproveCommand(taskId(values), environment),
);
const taskCommentCommand = withCliHandler(
  leaf("comment", "Append a Markdown Task comment.", {
    taskId: taskIdArgument,
    file: Options.text("file"),
  }),
  (values, environment) =>
    runCommentCommand(
      { taskId: requiredString(values, "taskId"), file: requiredString(values, "file") },
      environment,
    ),
);
const taskCancelCommand = withCliHandler(
  leaf("cancel", "Permanently cancel an unfinished Task.", {
    taskId: taskIdArgument,
    reason: Options.text("reason"),
  }),
  (values, environment) =>
    runCancelCommand(
      { taskId: requiredString(values, "taskId"), reason: requiredString(values, "reason") },
      environment,
    ),
);
let taskCommand: AnyCommand;
taskCommand = group(
  "task",
  "Manage repo-local Tasks.",
  [
    taskCreateCommand,
    taskDependenciesCommand,
    taskListCommand,
    taskShowCommand,
    taskApproveCommand,
    taskContextCommand,
    taskCommentCommand,
    taskCancelCommand,
  ],
  {},
  () => generatedCommandUsage(taskCommand),
);

const changeDecisionAddCommand = withCliHandler(
  leaf("add", "Record one Implementer Implementation Decision.", {
    changeId: changeIdArgument,
    file: Options.text("file"),
  }),
  (values, environment) =>
    runDecision(
      {
        action: "add",
        changeId: requiredString(values, "changeId"),
        file: requiredString(values, "file"),
      },
      environment as ChangeCommandEnvironment,
    ),
);
const changeDecisionListCommand = withCliHandler(
  leaf("list", "List the Change Implementation Decision Log.", {
    changeId: changeIdArgument,
  }),
  (values, environment) =>
    runDecision(
      { action: "list", changeId: requiredString(values, "changeId") },
      environment as ChangeCommandEnvironment,
    ),
);
let changeDecisionCommand: AnyCommand;
changeDecisionCommand = group(
  "decision",
  "Manage Implementation Decisions.",
  [changeDecisionAddCommand, changeDecisionListCommand],
  {},
  () => generatedCommandUsage(changeDecisionCommand),
);

const changeBlockerRaiseCommand = withCliHandler(
  leaf("raise", "Report an Implementation Blocker.", {
    changeId: changeIdArgument,
    file: Options.text("file"),
  }),
  (values, environment) =>
    runBlocker(
      {
        action: "raise",
        changeId: requiredString(values, "changeId"),
        file: requiredString(values, "file"),
      },
      environment as ChangeCommandEnvironment,
    ),
);
const changeBlockerResolveCommand = withCliHandler(
  leaf("resolve", "Record an approved Implementation Blocker Resolution.", {
    changeId: changeIdArgument,
    file: Options.text("file"),
  }),
  (values, environment) =>
    runBlocker(
      {
        action: "resolve",
        changeId: requiredString(values, "changeId"),
        file: requiredString(values, "file"),
      },
      environment as ChangeCommandEnvironment,
    ),
);
const changeBlockerListCommand = withCliHandler(
  leaf("list", "List blocker and Resolution history.", { changeId: changeIdArgument }),
  (values, environment) =>
    runBlocker(
      { action: "list", changeId: requiredString(values, "changeId") },
      environment as ChangeCommandEnvironment,
    ),
);
let changeBlockerCommand: AnyCommand;
changeBlockerCommand = group(
  "blocker",
  "Manage Implementation Blockers.",
  [changeBlockerRaiseCommand, changeBlockerResolveCommand, changeBlockerListCommand],
  {},
  () => generatedCommandUsage(changeBlockerCommand),
);

const changeStartCommand = withCliHandler(
  leaf("start", "Create a prepared Change worktree.", {
    task: optionalText("task"),
    base: optionalText("base"),
  }),
  (values, environment) =>
    runStart(
      {
        taskId: optionalString(values, "task"),
        baseBranch: optionalString(values, "base"),
      },
      environment as ChangeCommandEnvironment,
    ),
);
const changePrepareCommand = withCliHandler(
  leaf("prepare", "Run or retry Repository Preparation.", {
    changeId: Args.optional(changeIdArgument),
  }),
  (values, environment) =>
    runPrepare(
      { changeId: optionalString(values, "changeId") },
      environment as ChangeCommandEnvironment,
    ),
);
const changeListCommand = withCliHandler(
  leaf("list", "List Changes oldest first.", { all: Options.boolean("all") }),
  (values, environment) =>
    runChangeList({ all: boolean(values, "all") }, environment as ChangeCommandEnvironment),
);
const changeShowCommand = withCliHandler(
  leaf("show", "Show decision-oriented Change state.", {
    changeId: Args.optional(changeIdArgument),
  }),
  (values, environment) =>
    runChangeShow(
      { changeId: optionalString(values, "changeId") },
      environment as ChangeCommandEnvironment,
    ),
);
const changeFindingsCommand = withCliHandler(
  leaf("findings", "Show Findings for the current Change Candidate.", {
    changeId: Args.optional(changeIdArgument),
  }),
  (values, environment) =>
    runFindings(
      { changeId: optionalString(values, "changeId") },
      environment as ChangeCommandEnvironment,
    ),
);
const changeValidationRunsCommand = withCliHandler(
  leaf("validation-runs", "List complete Validation Run history.", {
    changeId: Args.optional(changeIdArgument),
  }),
  (values, environment) =>
    runValidationRuns(
      { changeId: optionalString(values, "changeId") },
      environment as ChangeCommandEnvironment,
    ),
);
const changeSubmitCommand = withCliHandler(
  leaf("submit", "Validate and publish a ready Change.", {
    changeId: Args.optional(changeIdArgument),
  }),
  (values, environment) =>
    runSubmit(
      { changeId: optionalString(values, "changeId") },
      environment as ChangeCommandEnvironment,
    ),
);
const changeCancelCommand = withCliHandler(
  leaf("cancel", "Cancel an open taskless Change.", {
    changeId: Args.optional(changeIdArgument),
  }),
  (values, environment) =>
    runChangeCancel(
      { changeId: optionalString(values, "changeId") },
      environment as ChangeCommandEnvironment,
    ),
);
const changeReconcileCommand = withCliHandler(
  leaf("reconcile", "Read owned pull requests and clean up terminal Changes.", {
    changeId: Args.optional(changeIdArgument),
  }),
  (values, environment) =>
    runReconcile(
      { changeId: optionalString(values, "changeId") },
      environment as ChangeCommandEnvironment,
    ),
);
const changeImplementCommand = withCliHandler(
  leaf("implement", "Launch an Interactive Session in a ready Change worktree.", {
    changeId: Args.optional(changeIdArgument),
    handoffFile: optionalText("handoff-file"),
  }),
  (values, environment) =>
    runImplement(
      {
        changeId: optionalString(values, "changeId"),
        handoffFile: optionalString(values, "handoffFile"),
      },
      environment as ChangeCommandEnvironment,
    ),
);
let changeCommand: AnyCommand;
changeCommand = group(
  "change",
  "Manage Changes and their Candidates.",
  [
    changeStartCommand,
    changePrepareCommand,
    changeListCommand,
    changeShowCommand,
    changeFindingsCommand,
    changeValidationRunsCommand,
    changeSubmitCommand,
    changeCancelCommand,
    changeReconcileCommand,
    changeImplementCommand,
    changeDecisionCommand,
    changeBlockerCommand,
  ],
  {},
  () => generatedCommandUsage(changeCommand),
);

const validationRunShowCommand = withCliHandler(
  leaf("show", "Show Validation Run policy and recorded evidence.", {
    validationRunId: Args.text({ name: "validation-run-id" }),
  }),
  (values, environment) =>
    runValidationRunShowCommand(
      { validationRunId: requiredString(values, "validationRunId") },
      environment,
    ),
);
const validationRunAbandonCommand = withCliHandler(
  leaf("abandon", "Explicitly abandon an interrupted Validation Run.", {
    validationRunId: Args.text({ name: "validation-run-id" }),
    reason: Options.text("reason"),
  }),
  (values, environment) =>
    runAbandonCommand(
      {
        validationRunId: requiredString(values, "validationRunId"),
        reason: requiredString(values, "reason"),
      },
      environment,
    ),
);
const validationRunArtifactCommand = withCliHandler(
  leaf("artifact", "Show complete stored Artifact content.", {
    validationRunId: Args.text({ name: "validation-run-id" }),
    artifactRef: Args.text({ name: "artifact-ref" }),
  }),
  (values, environment) =>
    runArtifactCommand(
      {
        validationRunId: requiredString(values, "validationRunId"),
        artifactRef: requiredString(values, "artifactRef"),
      },
      environment,
    ),
);
let validationRunCommand: AnyCommand;
validationRunCommand = group(
  "validation-run",
  "Inspect Validation Runs and Artifacts.",
  [validationRunShowCommand, validationRunAbandonCommand, validationRunArtifactCommand],
  {},
  () => generatedCommandUsage(validationRunCommand),
);

const initCommand = withCliHandler(
  leaf("init", "Create repo-local But Why? state.", {
    taskPrefix: Options.text("task-prefix"),
  }),
  (values, environment) =>
    runInitCommand({ taskPrefix: requiredString(values, "taskPrefix") }, environment),
);

const globalOutput = Options.withAlias(
  Options.withDefault(Options.choice("output", outputFormats), "toon"),
  "o",
);

const commandRootBase = Command.make("by", { output: globalOutput }).pipe(
  Command.withDescription("Validate completed code changes against approved human intent."),
) as unknown as AnyCommand;
const commandRootWithHandler = withCliHandler(commandRootBase, (_values, environment) =>
  dashboardResult(environment),
);
const commandTree = commandRootWithHandler.pipe(
  withSubcommands([initCommand, taskCommand, changeCommand, validationRunCommand]),
) as unknown as AnyCommand;

const cliConfig = CliConfig.make({});
const finalCheckBuiltInConfig = CliConfig.make({ finalCheckBuiltIn: true });
const packageVersion = (createRequire(import.meta.url)("../package.json") as { version: string })
  .version;
const stderrLogger = (writeStderr: (message: string) => void) =>
  Logger.make(({ logLevel, message }) => {
    writeStderr(`level=${logLevel.label} message=${String(message)}\n`);
  });
const runtimeLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, NodeTerminal.layer);

export const runCommandTree = (
  args: readonly string[],
  environment: CliEnvironment,
): Effect.Effect<CliResult> =>
  Effect.gen(function* () {
    const resultRef = yield* Ref.make<CliResult | undefined>(undefined);
    const helpOutput: string[] = [];
    const run = Command.run(commandTree, { executable: "by", name: "by", version: packageVersion })(
      ["by", "by", ...args],
    );
    const runWithConfig = (config: CliConfig.CliConfig, versionProbe = false) =>
      Console.consoleWith((console) =>
        Console.withConsole({
          ...console,
          log: (message) => {
            const text = String(message);
            if (versionProbe && nativeHelpText(text) !== packageVersion) {
              return Effect.fail("not_version_output") as unknown as Effect.Effect<void>;
            }
            return Effect.sync(() => void helpOutput.push(text));
          },
          error: () => Effect.void,
        })(
          run.pipe(
            Effect.provide(
              Layer.mergeAll(
                runtimeLayer,
                CliConfig.layer(config),
                Logger.replace(
                  Logger.defaultLogger,
                  stderrLogger(environment.writeStderr ?? (() => undefined)),
                ),
                Layer.succeed(CliEnvironmentContext, environment),
                Layer.succeed(CliResultSink, (result) =>
                  Ref.set(resultRef, {
                    ...result,
                    outputFormat: outputFormatForArgs(args),
                  }),
                ),
              ),
            ),
          ),
        ),
      );
    const initialCommandResult = yield* Effect.either(runWithConfig(cliConfig));
    let commandResult = initialCommandResult;
    if (
      initialCommandResult._tag === "Left" &&
      ValidationError.isValidationError(initialCommandResult.left) &&
      !generatedText(initialCommandResult.left.error).includes(
        "Expected one of the following cases: toon, json",
      )
    ) {
      const fallbackCommandResult = yield* Effect.either(
        runWithConfig(finalCheckBuiltInConfig, true),
      );
      if (
        fallbackCommandResult._tag === "Right" &&
        helpOutput.length > 0 &&
        nativeHelpText(helpOutput.at(-1) ?? "") === packageVersion
      ) {
        commandResult = fallbackCommandResult;
      }
    }

    if (commandResult._tag === "Left") {
      if (ValidationError.isValidationError(commandResult.left)) {
        return {
          ...usageError({
            code: "invalid_usage",
            message: generatedText(commandResult.left.error),
            help: ["Run `by --help` for generated command help."],
          }),
          outputFormat: outputFormatForArgs(args),
        };
      }
      return yield* Effect.fail(commandResult.left);
    }

    const captured = yield* Ref.get(resultRef);
    if (captured !== undefined) return captured;
    if (helpOutput.length > 0) {
      const nativeOutput = nativeHelpText(helpOutput.join("\n"));
      return {
        ...success(
          nativeOutput === packageVersion
            ? { version: packageVersion }
            : { help: rootHelpCorrection(nativeOutput) },
        ),
        outputFormat: outputFormatForArgs(args),
      };
    }
    return {
      ...usageError({
        code: "invalid_usage",
        message: "The command did not produce a result.",
        help: ["Run `by --help` for generated command help."],
      }),
      outputFormat: outputFormatForArgs(args),
    };
  });

const dashboardResult = (environment: CliEnvironment): Effect.Effect<CliResult> =>
  dashboard(
    collapseHome(environment.executablePath),
    "Validate completed code changes against approved human intent.",
    environment,
  );

const generatedCommandUsage = (command: AnyCommand): Effect.Effect<CliResult> =>
  Effect.succeed(
    usageError({
      code: "invalid_usage",
      message: rootHelpCorrection(generatedText(Command.getHelp(command, cliConfig))),
      help: ["Run `by --help` for generated command help."],
    }),
  );

const requiredString = (values: Record<string, unknown>, key: string): string => {
  const value = optionalValue(values[key]);
  return typeof value === "string" ? value : "";
};

const optionalString = (values: Record<string, unknown>, key: string): string | undefined => {
  const value = optionalValue(values[key]);
  return typeof value === "string" ? value : undefined;
};

const strings = (values: Record<string, unknown>, key: string): readonly string[] => {
  const value = values[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
};

const boolean = (values: Record<string, unknown>, key: string): boolean => values[key] === true;

const optionalValue = (value: unknown): unknown => {
  if (!isRecord(value)) return value;
  return value["_tag"] === "Some" ? value["value"] : undefined;
};

const taskId = (values: Record<string, unknown>): { readonly taskId: string } => ({
  taskId: requiredString(values, "taskId"),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const outputFormatForArgs = (args: readonly string[]): OutputFormat => {
  for (let index = 0; index < args.length; index += 1) {
    const selector = args[index];
    if (selector === "--output" || selector === "-o") {
      return args[index + 1] === "json" ? "json" : "toon";
    }
    if (selector?.startsWith("--output=") || selector?.startsWith("-o=")) {
      return selector.split("=", 2)[1] === "json" ? "json" : "toon";
    }
  }
  return "toon";
};

const generatedText = (help: HelpDoc.HelpDoc): string => {
  const ansiEscape = String.fromCharCode(27);
  return HelpDoc.toAnsiText(help)
    .replaceAll(new RegExp(`${ansiEscape}\\[[0-9;]*m`, "gu"), "")
    .trim();
};

const nativeHelpText = (help: string): string => {
  const ansiEscape = String.fromCharCode(27);
  const plain = help.replaceAll(new RegExp(`${ansiEscape}\\[[0-9;]*m`, "gu"), "").trim();
  const descriptionIndex = plain.indexOf("DESCRIPTION");
  return descriptionIndex < 0 ? plain : plain.slice(descriptionIndex);
};

const rootHelpCorrection = (help: string): string =>
  help
    .replaceAll(/\b(task|change|validation-run) \1\b/gu, "$1")
    .replaceAll(/\[<task-id>\] (?=(draft|apply) <task-id>)/gu, "");
