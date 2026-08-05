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
import { success, usageError, type CliResult } from "./cliResults.js";
import type { ChangeCommandEnvironment } from "./cli/change/changeTypes.js";
import {
  hasInvalidJsonSelector,
  nativeBooleanValue,
  outputFormatForArgs,
} from "./output/selection.js";
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
const requiredRepeatedText = (name: string) => Options.atLeast(1)(Options.text(name));
const taskIdArgument = Args.text({ name: "task-id" });
const changeIdArgument = Args.text({ name: "change-id" });

const taskDependenciesOperationCommand = (
  operation: "add" | "remove" | "replace",
  description: string,
) =>
  withCliHandler(
    leaf(operation, description, {
      taskId: taskIdArgument,
      dependsOn: requiredRepeatedText("depends-on"),
    }),
    (values, environment) =>
      Effect.promise(() => import("./cli/task/commands/dependencies.js")).pipe(
        Effect.flatMap(({ runDependenciesCommand }) =>
          runDependenciesCommand(
            {
              operation,
              taskId: requiredString(values, "taskId"),
              dependsOn: strings(values, "dependsOn"),
            },
            environment,
          ),
        ),
      ),
  );

const taskDependenciesClearCommand = withCliHandler(
  leaf("clear", "Remove all direct Task prerequisites before Start.", {
    taskId: taskIdArgument,
  }),
  (values, environment) =>
    Effect.promise(() => import("./cli/task/commands/dependencies.js")).pipe(
      Effect.flatMap(({ runDependenciesCommand }) =>
        runDependenciesCommand(
          {
            operation: "clear",
            taskId: requiredString(values, "taskId"),
            dependsOn: [],
          },
          environment,
        ),
      ),
    ),
);

let taskDependenciesCommand: AnyCommand;
taskDependenciesCommand = group(
  "dependencies",
  "Manage direct Task prerequisites.",
  [
    taskDependenciesOperationCommand("add", "Add direct Task prerequisites before Start."),
    taskDependenciesOperationCommand("remove", "Remove direct Task prerequisites before Start."),
    taskDependenciesOperationCommand(
      "replace",
      "Replace all direct Task prerequisites before Start.",
    ),
    taskDependenciesClearCommand,
  ],
  {},
  () => generatedCommandUsage(taskDependenciesCommand),
);

const taskContextDraftCommand = withCliHandler(
  leaf("draft", "Create an editable Task Context draft.", { taskId: taskIdArgument }),
  (values, environment) =>
    Effect.promise(() => import("./cli/task/commands/contextDraft.js")).pipe(
      Effect.flatMap(({ runContextDraftCommand }) =>
        runContextDraftCommand(taskId(values), environment),
      ),
    ),
);
const taskContextApplyCommand = withCliHandler(
  leaf("apply", "Apply a Task Context draft.", { taskId: taskIdArgument }),
  (values, environment) =>
    Effect.promise(() => import("./cli/task/commands/contextApply.js")).pipe(
      Effect.flatMap(({ runContextApplyCommand }) =>
        runContextApplyCommand(taskId(values), environment),
      ),
    ),
);
let taskContextCommand: AnyCommand;
taskContextCommand = group(
  "context",
  "Show or edit Task Context.",
  [taskContextDraftCommand, taskContextApplyCommand],
  { taskId: Args.optional(taskIdArgument) },
  (values, environment) => {
    const taskId = optionalString(values, "taskId");
    if (taskId === undefined) return generatedCommandUsage(taskContextCommand);
    return Effect.promise(() => import("./cli/task/commands/context.js")).pipe(
      Effect.flatMap(({ runContextCommand }) => runContextCommand({ taskId }, environment)),
    );
  },
);

const taskCreateCommand = withCliHandler(
  leaf("create", "Create a repo-local Task.", {
    title: Options.text("title"),
    file: Options.text("file").pipe(
      Options.withDescription(
        "Use --file <path|-> with a regular UTF-8 text file path or - to read standard input.",
      ),
    ),
    dependsOn: repeatedText("depends-on"),
  }),
  (values, environment) =>
    Effect.promise(() => import("./cli/task/commands/create.js")).pipe(
      Effect.flatMap(({ runCreateCommand }) =>
        runCreateCommand(
          {
            title: requiredString(values, "title"),
            file: requiredString(values, "file"),
            dependsOn: strings(values, "dependsOn"),
          },
          environment,
        ),
      ),
    ),
);
const taskListCommand = withCliHandler(
  leaf("list", "List repo-local Tasks.", {
    all: Options.boolean("all"),
    state: Options.choice("state", taskStates).pipe(Options.optional),
    limit: Options.withDefault(Options.text("limit"), "5"),
  }),
  (values, environment) =>
    Effect.promise(() => import("./cli/task/commands/list.js")).pipe(
      Effect.flatMap(({ runListCommand }) =>
        runListCommand(
          {
            all: boolean(values, "all"),
            state: optionalString(values, "state") as TaskState | undefined,
            limit: requiredString(values, "limit"),
          },
          environment,
        ),
      ),
    ),
);
const taskShowCommand = withCliHandler(
  leaf("show", "Show decision-oriented Task metadata.", { taskId: taskIdArgument }),
  (values, environment) =>
    Effect.promise(() => import("./cli/task/commands/show.js")).pipe(
      Effect.flatMap(({ runTaskShowCommand }) => runTaskShowCommand(taskId(values), environment)),
    ),
);
const taskApproveCommand = withCliHandler(
  leaf("approve", "Permanently approve Task intent.", { taskId: taskIdArgument }),
  (values, environment) =>
    Effect.promise(() => import("./cli/task/commands/approve.js")).pipe(
      Effect.flatMap(({ runApproveCommand }) => runApproveCommand(taskId(values), environment)),
    ),
);
const taskCommentCommand = withCliHandler(
  leaf("comment", "Append a Task comment.", {
    taskId: taskIdArgument,
    file: Options.text("file").pipe(
      Options.withDescription(
        "Use --file <path|-> with a regular UTF-8 text file path or - to read standard input.",
      ),
    ),
  }),
  (values, environment) =>
    Effect.promise(() => import("./cli/task/commands/comment.js")).pipe(
      Effect.flatMap(({ runCommentCommand }) =>
        runCommentCommand(
          { taskId: requiredString(values, "taskId"), file: requiredString(values, "file") },
          environment,
        ),
      ),
    ),
);
const taskCancelCommand = withCliHandler(
  leaf("cancel", "Permanently cancel an unfinished Task.", {
    taskId: taskIdArgument,
    reason: Options.text("reason"),
  }),
  (values, environment) =>
    Effect.promise(() => import("./cli/task/commands/cancel.js")).pipe(
      Effect.flatMap(({ runCancelCommand }) =>
        runCancelCommand(
          { taskId: requiredString(values, "taskId"), reason: requiredString(values, "reason") },
          environment,
        ),
      ),
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
    choice: Options.text("choice").pipe(
      Options.withDescription("The selected one-line material approach."),
    ),
    rationale: Options.text("rationale").pipe(
      Options.withDescription("Why the approach was selected and its material trade-off."),
    ),
  }),
  (values, environment) =>
    Effect.promise(() => import("./cli/change/decision.js")).pipe(
      Effect.flatMap(({ runDecision }) =>
        runDecision(
          {
            action: "add",
            changeId: requiredString(values, "changeId"),
            choice: requiredString(values, "choice"),
            rationale: requiredString(values, "rationale"),
          },
          environment as ChangeCommandEnvironment,
        ),
      ),
    ),
);
const changeDecisionListCommand = withCliHandler(
  leaf("list", "List the Change Implementation Decision Log.", {
    changeId: changeIdArgument,
  }),
  (values, environment) =>
    Effect.promise(() => import("./cli/change/decision.js")).pipe(
      Effect.flatMap(({ runDecision }) =>
        runDecision(
          { action: "list", changeId: requiredString(values, "changeId") },
          environment as ChangeCommandEnvironment,
        ),
      ),
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
  leaf(
    "raise",
    "Report an unresolved issue, why continuing is unsafe, and the required external decision or action.",
    {
      changeId: changeIdArgument,
      file: Options.text("file").pipe(
        Options.withDescription(
          "Use --file <path|-> with a regular UTF-8 text file path or - to read standard input.",
        ),
      ),
    },
  ),
  (values, environment) =>
    Effect.promise(() => import("./cli/change/blocker.js")).pipe(
      Effect.flatMap(({ runBlocker }) =>
        runBlocker(
          {
            action: "raise",
            changeId: requiredString(values, "changeId"),
            file: requiredString(values, "file"),
          },
          environment as ChangeCommandEnvironment,
        ),
      ),
    ),
);
const changeBlockerResolveCommand = withCliHandler(
  leaf("resolve", "Record an approved Implementation Blocker Resolution.", {
    changeId: changeIdArgument,
    file: Options.text("file").pipe(
      Options.withDescription(
        "Use --file <path|-> with a regular UTF-8 text file path or - to read standard input.",
      ),
    ),
  }),
  (values, environment) =>
    Effect.promise(() => import("./cli/change/blocker.js")).pipe(
      Effect.flatMap(({ runBlocker }) =>
        runBlocker(
          {
            action: "resolve",
            changeId: requiredString(values, "changeId"),
            file: requiredString(values, "file"),
          },
          environment as ChangeCommandEnvironment,
        ),
      ),
    ),
);
const changeBlockerListCommand = withCliHandler(
  leaf("list", "List blocker and Resolution history.", { changeId: changeIdArgument }),
  (values, environment) =>
    Effect.promise(() => import("./cli/change/blocker.js")).pipe(
      Effect.flatMap(({ runBlocker }) =>
        runBlocker(
          { action: "list", changeId: requiredString(values, "changeId") },
          environment as ChangeCommandEnvironment,
        ),
      ),
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
  leaf("start", "Create a Change worktree and attempt preparation.", {
    task: optionalText("task"),
    base: optionalText("base"),
  }),
  (values, environment) =>
    Effect.promise(() => import("./cli/change/start.js")).pipe(
      Effect.flatMap(({ runStart }) =>
        runStart(
          {
            taskId: optionalString(values, "task"),
            baseBranch: optionalString(values, "base"),
          },
          environment as ChangeCommandEnvironment,
        ),
      ),
    ),
);
const changePrepareCommand = withCliHandler(
  leaf("prepare", "Run or retry Repository Preparation.", {
    changeId: Args.optional(changeIdArgument),
  }),
  (values, environment) =>
    Effect.promise(() => import("./cli/change/prepare.js")).pipe(
      Effect.flatMap(({ runPrepare }) =>
        runPrepare(
          { changeId: optionalString(values, "changeId") },
          environment as ChangeCommandEnvironment,
        ),
      ),
    ),
);
const changeListCommand = withCliHandler(
  leaf("list", "List Changes oldest first.", { all: Options.boolean("all") }),
  (values, environment) =>
    Effect.promise(() => import("./cli/change/list.js")).pipe(
      Effect.flatMap(({ runList }) =>
        runList({ all: boolean(values, "all") }, environment as ChangeCommandEnvironment),
      ),
    ),
);
const changeShowCommand = withCliHandler(
  leaf("show", "Show decision-oriented Change state.", {
    changeId: Args.optional(changeIdArgument),
  }),
  (values, environment) =>
    Effect.promise(() => import("./cli/change/show.js")).pipe(
      Effect.flatMap(({ runShow }) =>
        runShow(
          { changeId: optionalString(values, "changeId") },
          environment as ChangeCommandEnvironment,
        ),
      ),
    ),
);
const changeFindingsCommand = withCliHandler(
  leaf("findings", "Show Findings for the current Change Candidate.", {
    changeId: Args.optional(changeIdArgument),
  }),
  (values, environment) =>
    Effect.promise(() => import("./cli/change/findings.js")).pipe(
      Effect.flatMap(({ runFindings }) =>
        runFindings(
          { changeId: optionalString(values, "changeId") },
          environment as ChangeCommandEnvironment,
        ),
      ),
    ),
);
const changeValidationRunsCommand = withCliHandler(
  leaf("validation-runs", "List complete Validation Run history.", {
    changeId: Args.optional(changeIdArgument),
  }),
  (values, environment) =>
    Effect.promise(() => import("./cli/change/validationRuns.js")).pipe(
      Effect.flatMap(({ runValidationRuns }) =>
        runValidationRuns(
          { changeId: optionalString(values, "changeId") },
          environment as ChangeCommandEnvironment,
        ),
      ),
    ),
);
const changeSubmitCommand = withCliHandler(
  leaf("submit", "Validate and publish a Change.", {
    changeId: Args.optional(changeIdArgument),
  }),
  (values, environment) =>
    Effect.promise(() => import("./cli/change/submit.js")).pipe(
      Effect.flatMap(({ runSubmit }) =>
        runSubmit(
          { changeId: optionalString(values, "changeId") },
          environment as ChangeCommandEnvironment,
        ),
      ),
    ),
);
const changeCancelCommand = withCliHandler(
  leaf("cancel", "Cancel an open taskless Change.", {
    changeId: Args.optional(changeIdArgument),
  }),
  (values, environment) =>
    Effect.promise(() => import("./cli/change/cancel.js")).pipe(
      Effect.flatMap(({ runCancel }) =>
        runCancel(
          { changeId: optionalString(values, "changeId") },
          environment as ChangeCommandEnvironment,
        ),
      ),
    ),
);
const changeReconcileCommand = withCliHandler(
  leaf("reconcile", "Read owned pull requests and clean up terminal Changes.", {
    changeId: Args.optional(changeIdArgument),
    discardWork: Options.boolean("discard-work"),
  }),
  (values, environment) =>
    Effect.promise(() => import("./cli/change/reconcile.js")).pipe(
      Effect.flatMap(({ runReconcile }) =>
        runReconcile(
          {
            changeId: optionalString(values, "changeId"),
            discardWork: boolean(values, "discardWork"),
          },
          environment as ChangeCommandEnvironment,
        ),
      ),
    ),
);
const changeImplementCommand = withCliHandler(
  leaf("implement", "Launch an Interactive Session in a Change worktree.", {
    changeId: Args.optional(changeIdArgument),
    implementerPromptFile: optionalText("implementer-prompt-file"),
  }),
  (values, environment) =>
    Effect.promise(() => import("./cli/change/implement.js")).pipe(
      Effect.flatMap(({ runImplement }) =>
        runImplement(
          {
            changeId: optionalString(values, "changeId"),
            implementerPromptFile: optionalString(values, "implementerPromptFile"),
          },
          environment as ChangeCommandEnvironment,
        ),
      ),
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
    Effect.promise(() => import("./cli/validationRun/show.js")).pipe(
      Effect.flatMap(({ runShowCommand }) =>
        runShowCommand({ validationRunId: requiredString(values, "validationRunId") }, environment),
      ),
    ),
);
const validationRunAbandonCommand = withCliHandler(
  leaf("abandon", "Explicitly abandon an interrupted Validation Run.", {
    validationRunId: Args.text({ name: "validation-run-id" }),
    reason: Options.text("reason"),
  }),
  (values, environment) =>
    Effect.promise(() => import("./cli/validationRun/abandon.js")).pipe(
      Effect.flatMap(({ runAbandonCommand }) =>
        runAbandonCommand(
          {
            validationRunId: requiredString(values, "validationRunId"),
            reason: requiredString(values, "reason"),
          },
          environment,
        ),
      ),
    ),
);
const validationRunArtifactCommand = withCliHandler(
  leaf("artifact", "Show complete stored Artifact content.", {
    validationRunId: Args.text({ name: "validation-run-id" }),
    artifactRef: Args.text({ name: "artifact-ref" }),
  }),
  (values, environment) =>
    Effect.promise(() => import("./cli/validationRun/artifact.js")).pipe(
      Effect.flatMap(({ runArtifactCommand }) =>
        runArtifactCommand(
          {
            validationRunId: requiredString(values, "validationRunId"),
            artifactRef: requiredString(values, "artifactRef"),
          },
          environment,
        ),
      ),
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
    Effect.promise(() => import("./cli/initCli.js")).pipe(
      Effect.flatMap(({ runInitCommand }) =>
        runInitCommand({ taskPrefix: requiredString(values, "taskPrefix") }, environment),
      ),
    ),
);
const snapshotCommand = withCliHandler(
  leaf("snapshot", "Create an immutable Shared Repository State Snapshot."),
  (_values, environment) =>
    Effect.promise(() => import("./cli/snapshot.js")).pipe(
      Effect.flatMap(({ runSnapshotCommand }) => runSnapshotCommand(environment)),
    ),
);

const commandRootBase = Command.make("by", { json: Options.boolean("json") }).pipe(
  Command.withDescription("Validate completed code changes against approved human intent."),
) as unknown as AnyCommand;
const commandRootWithHandler = withCliHandler(commandRootBase, (_values, environment) =>
  dashboardResult(environment),
);
const commandTree = commandRootWithHandler.pipe(
  withSubcommands([initCommand, snapshotCommand, taskCommand, changeCommand, validationRunCommand]),
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
    const outputFormat = outputFormatForArgs(args);
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
                    outputFormat,
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
      !hasInvalidJsonSelector(args)
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
        const missingOperation = missingDependencyOperation(
          args,
          generatedText(commandResult.left.error),
        );
        if (missingOperation !== undefined) {
          return {
            ...dependencyOptionRequiredErrorResult(missingOperation),
            outputFormat,
          };
        }
        return {
          ...usageError({
            code: "invalid_usage",
            message: generatedText(commandResult.left.error),
            help: ["Run `by --help` for generated command help."],
          }),
          outputFormat,
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
        outputFormat,
      };
    }
    return {
      ...usageError({
        code: "invalid_usage",
        message: "The command did not produce a result.",
        help: ["Run `by --help` for generated command help."],
      }),
      outputFormat,
    };
  });

const dashboardResult = (environment: CliEnvironment): Effect.Effect<CliResult> =>
  Effect.promise(() => import("./cli/task/dashboard.js")).pipe(
    Effect.flatMap(({ dashboard }) =>
      dashboard(
        collapseHome(environment.executablePath),
        "Validate completed code changes against approved human intent.",
        environment,
      ),
    ),
  );

const generatedCommandUsage = (command: AnyCommand): Effect.Effect<CliResult> =>
  Effect.succeed(
    usageError({
      code: "invalid_usage",
      message: rootHelpCorrection(generatedText(Command.getHelp(command, cliConfig))),
      help: ["Run `by --help` for generated command help."],
    }),
  );

const dependencyOptionRequiredErrorResult = (operation: "add" | "remove" | "replace"): CliResult =>
  usageError({
    code: operation === "replace" ? "replace_requires_dependency" : "depends_on_required",
    message:
      operation === "replace"
        ? "The replace operation requires at least one prerequisite."
        : `The ${operation} operation requires at least one --depends-on value.`,
    help: [
      operation === "replace"
        ? "Use `by task dependencies clear <task-id>` to remove all prerequisites."
        : `Use \`by task dependencies ${operation} <task-id> --depends-on <task-id>\`.`,
    ],
  });

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
  const option = value as { readonly _tag?: unknown; readonly value?: unknown };
  return option._tag === "Some" ? option.value : undefined;
};

const taskId = (values: Record<string, unknown>): { readonly taskId: string } => ({
  taskId: requiredString(values, "taskId"),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const missingDependencyOperation = (
  args: readonly string[],
  validationMessage: string,
): "add" | "remove" | "replace" | undefined => {
  if (validationMessage !== "Expected at least 1 value(s) for option: '--depends-on'") {
    return undefined;
  }
  const positional = validGlobalOptionSyntax(args);
  if (positional === undefined || positional.length !== 4) return undefined;
  const [command, group, operation] = positional;
  return command === "task" &&
    group === "dependencies" &&
    (operation === "add" || operation === "remove" || operation === "replace")
    ? operation
    : undefined;
};

const validGlobalOptionSyntax = (args: readonly string[]): readonly string[] | undefined => {
  const seen = new Set<string>();
  const positional: string[] = [];
  const valueOptions = new Map([
    [
      "--log-level",
      new Set(["all", "trace", "debug", "info", "warning", "error", "fatal", "none"]),
    ],
    ["--completions", new Set(["sh", "bash", "fish", "zsh"])],
  ]);
  const aliases = new Map<string, string>();
  const flags = new Set(["--wizard", "--version", "--help", "-h"]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) return undefined;
    if (!argument.startsWith("-")) {
      positional.push(argument);
      continue;
    }
    if (argument.startsWith("--json=")) {
      if (nativeBooleanValue(argument.slice("--json=".length)) === undefined) return undefined;
      continue;
    }
    if (argument.includes("=")) return undefined;
    if (argument === "--json") {
      if (nativeBooleanValue(args[index + 1]) !== undefined) index += 1;
      continue;
    }
    const option = aliases.get(argument) ?? argument;
    if (flags.has(option)) {
      if (seen.has(option)) return undefined;
      seen.add(option);
      continue;
    }
    const values = valueOptions.get(option);
    if (values === undefined || seen.has(option)) return undefined;
    const value = args[++index];
    if (value === undefined || value.startsWith("-") || !values.has(value)) return undefined;
    seen.add(option);
  }
  return positional;
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
