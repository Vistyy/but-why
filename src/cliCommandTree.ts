import { createRequire } from "node:module";
import * as Args from "@effect/cli/Args";
import * as CliConfig from "@effect/cli/CliConfig";
import * as Command from "@effect/cli/Command";
import * as HelpDoc from "@effect/cli/HelpDoc";
import * as Options from "@effect/cli/Options";
import * as ValidationError from "@effect/cli/ValidationError";
import { NodeFileSystem, NodePath, NodeTerminal } from "@effect/platform-node";
import { Console, Context, Effect, Layer, Logger, Option, Ref } from "effect";
import type * as Types from "effect/Types";
import type { ChangeCommandEnvironment } from "./cli/change/changeTypes.js";
import { collapseHome } from "./cli/cliPath.js";
import type { CliEnvironment } from "./cli.js";
import { type CliResult, success, usageError } from "./cliResults.js";
import { taskStates } from "./task/lifecycle.js";

class CliEnvironmentContext extends Context.Tag("@but-why/CliEnvironment")<
  CliEnvironmentContext,
  CliEnvironment
>() {}

class CliResultSink extends Context.Tag("@but-why/CliResultSink")<
  CliResultSink,
  (result: CliResult) => Effect.Effect<void>
>() {}

type CliHandlerContext = CliEnvironmentContext | CliResultSink;
// biome-ignore lint/suspicious/noExplicitAny: Effect CLI requires type erasure for heterogeneous command storage after handlers are attached.
type AnyCommand = Command.Command<any, CliHandlerContext, never, any>;
type Subcommands = readonly [AnyCommand, ...AnyCommand[]];
type ParsedConfig<Config extends Command.Command.Config> = Types.Simplify<
  Command.Command.ParseConfig<Config>
>;
type CliOperation<Values> = (
  values: Values,
  environment: CliEnvironment,
) => Effect.Effect<CliResult>;

const eraseCommandType = <Name extends string, Values>(
  command: Command.Command<Name, CliHandlerContext, never, Values>,
): AnyCommand => command;

const leaf = <Name extends string, const Config extends Command.Command.Config>(
  name: Name,
  description: string,
  config: Config,
) => Command.make(name, config).pipe(Command.withDescription(description));

const group = <Name extends string, const Config extends Command.Command.Config>(
  name: Name,
  description: string,
  children: readonly AnyCommand[],
  config: Config,
  operation: CliOperation<ParsedConfig<Config>>,
): AnyCommand => {
  const handled = withCliHandler(
    Command.make(name, config).pipe(Command.withDescription(description)),
    operation,
  );
  return eraseCommandType(handled.pipe(Command.withSubcommands(children as Subcommands)));
};

const withCliHandler = <Name extends string, R, E, Values>(
  command: Command.Command<Name, R, E, Values>,
  operation: CliOperation<Values>,
) => Command.withHandler(command, (values) => runCliOperation(values, operation));

const runCliOperation = <Values>(
  values: Values,
  operation: CliOperation<Values>,
): Effect.Effect<void, never, CliHandlerContext> =>
  Effect.contextWithEffect((context) =>
    operation(values, Context.get(context, CliEnvironmentContext)).pipe(
      Effect.flatMap((result) => Context.get(context, CliResultSink)(result)),
    ),
  );

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
              taskId: values.taskId,
              dependsOn: values.dependsOn,
            },
            environment,
          ),
        ),
      ),
  );

const taskDependenciesClearCommand = withCliHandler(
  leaf("clear", "Remove all direct Task prerequisites before Task Approval.", {
    taskId: taskIdArgument,
  }),
  (values, environment) =>
    Effect.promise(() => import("./cli/task/commands/dependencies.js")).pipe(
      Effect.flatMap(({ runDependenciesCommand }) =>
        runDependenciesCommand(
          {
            operation: "clear",
            taskId: values.taskId,
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
    taskDependenciesOperationCommand("add", "Add direct Task prerequisites before Task Approval."),
    taskDependenciesOperationCommand(
      "remove",
      "Remove direct Task prerequisites before Task Approval.",
    ),
    taskDependenciesOperationCommand(
      "replace",
      "Replace all direct Task prerequisites before Task Approval.",
    ),
    taskDependenciesClearCommand,
  ],
  {},
  () => generatedCommandUsage(taskDependenciesCommand),
);

const taskContextDraftCommand = withCliHandler(
  leaf("draft", "Create an editable Task description draft.", { taskId: taskIdArgument }),
  (values, environment) =>
    Effect.promise(() => import("./cli/task/commands/contextDraft.js")).pipe(
      Effect.flatMap(({ runContextDraftCommand }) =>
        runContextDraftCommand({ taskId: values.taskId }, environment),
      ),
    ),
);
const taskContextApplyCommand = withCliHandler(
  leaf("apply", "Apply a Task description draft.", { taskId: taskIdArgument }),
  (values, environment) =>
    Effect.promise(() => import("./cli/task/commands/contextApply.js")).pipe(
      Effect.flatMap(({ runContextApplyCommand }) =>
        runContextApplyCommand({ taskId: values.taskId }, environment),
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
    const taskId = Option.getOrUndefined(values.taskId);
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
            title: values.title,
            file: values.file,
            dependsOn: values.dependsOn,
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
            all: values.all,
            state: Option.getOrUndefined(values.state),
            limit: values.limit,
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
      Effect.flatMap(({ runTaskShowCommand }) =>
        runTaskShowCommand({ taskId: values.taskId }, environment),
      ),
    ),
);
const taskSubmitCommand = withCliHandler(
  leaf("submit", "Run an advisory review of one exact New Task proposal.", {
    taskId: taskIdArgument,
  }),
  (values, environment) =>
    Effect.promise(() => import("./cli/task/commands/submit.js")).pipe(
      Effect.flatMap(({ runTaskSubmitCommand }) =>
        runTaskSubmitCommand({ taskId: values.taskId }, environment),
      ),
    ),
);
const taskReviewsCommand = withCliHandler(
  leaf("reviews", "List ordered Task Review history and valid next actions.", {
    taskId: taskIdArgument,
  }),
  (values, environment) =>
    Effect.promise(() => import("./cli/task/commands/review.js")).pipe(
      Effect.flatMap(({ runTaskReviewCommand }) =>
        runTaskReviewCommand({ action: "list", taskId: values.taskId }, environment),
      ),
    ),
);
const taskReviewShowCommand = withCliHandler(
  leaf("show", "Inspect one exact Task Review and its recovery state.", {
    reviewId: Args.text({ name: "review-id" }),
  }),
  (values, environment) =>
    Effect.promise(() => import("./cli/task/commands/review.js")).pipe(
      Effect.flatMap(({ runTaskReviewCommand }) =>
        runTaskReviewCommand({ action: "show", reviewId: values.reviewId }, environment),
      ),
    ),
);
const taskReviewAbandonCommand = withCliHandler(
  leaf("abandon", "Clean and abandon one exact Active Task Review.", {
    reviewId: Args.text({ name: "review-id" }),
    reason: Options.text("reason"),
  }),
  (values, environment) =>
    Effect.promise(() => import("./cli/task/commands/review.js")).pipe(
      Effect.flatMap(({ runTaskReviewCommand }) =>
        runTaskReviewCommand(
          { action: "abandon", reviewId: values.reviewId, reason: values.reason },
          environment,
        ),
      ),
    ),
);
let taskReviewCommand: AnyCommand;
taskReviewCommand = group(
  "review",
  "Inspect and recover Task Reviews.",
  [taskReviewShowCommand, taskReviewAbandonCommand],
  {},
  () => generatedCommandUsage(taskReviewCommand),
);
let taskReviewTopCommand: AnyCommand;
taskReviewTopCommand = group(
  "task-review",
  "Inspect and recover Task Reviews.",
  [taskReviewShowCommand, taskReviewAbandonCommand],
  {},
  () => generatedCommandUsage(taskReviewTopCommand),
);
const taskApproveCommand = withCliHandler(
  leaf("approve", "Permanently approve Task intent.", { taskId: taskIdArgument }),
  (values, environment) =>
    Effect.promise(() => import("./cli/task/commands/approve.js")).pipe(
      Effect.flatMap(({ runApproveCommand }) =>
        runApproveCommand({ taskId: values.taskId }, environment),
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
        runCancelCommand({ taskId: values.taskId, reason: values.reason }, environment),
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
    taskSubmitCommand,
    taskReviewsCommand,
    taskReviewCommand,
    taskApproveCommand,
    taskContextCommand,
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
            changeId: values.changeId,
            choice: values.choice,
            rationale: values.rationale,
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
          { action: "list", changeId: values.changeId },
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
            changeId: values.changeId,
            file: values.file,
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
            changeId: values.changeId,
            file: values.file,
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
          { action: "list", changeId: values.changeId },
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
            taskId: Option.getOrUndefined(values.task),
            baseBranch: Option.getOrUndefined(values.base),
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
          { changeId: Option.getOrUndefined(values.changeId) },
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
        runList({ all: values.all }, environment as ChangeCommandEnvironment),
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
          { changeId: Option.getOrUndefined(values.changeId) },
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
          { changeId: Option.getOrUndefined(values.changeId) },
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
          { changeId: Option.getOrUndefined(values.changeId) },
          environment as ChangeCommandEnvironment,
        ),
      ),
    ),
);
const changeSubmitCommand = withCliHandler(
  leaf("submit", "Validate and publish a Change. This is a long-running command.", {
    changeId: Args.optional(changeIdArgument),
  }),
  (values, environment) =>
    Effect.promise(() => import("./cli/change/submit.js")).pipe(
      Effect.flatMap(({ runSubmit }) =>
        runSubmit(
          { changeId: Option.getOrUndefined(values.changeId) },
          environment as ChangeCommandEnvironment,
        ),
      ),
    ),
);
const changeCancelCommand = withCliHandler(
  leaf("cancel", "Cancel an unfinished Change.", {
    changeId: Args.optional(changeIdArgument),
    reason: Options.text("reason"),
  }),
  (values, environment) =>
    Effect.promise(() => import("./cli/change/cancel.js")).pipe(
      Effect.flatMap(({ runCancel }) =>
        runCancel(
          {
            changeId: Option.getOrUndefined(values.changeId),
            reason: values.reason,
          },
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
            changeId: Option.getOrUndefined(values.changeId),
            discardWork: values.discardWork,
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
            changeId: Option.getOrUndefined(values.changeId),
            implementerPromptFile: Option.getOrUndefined(values.implementerPromptFile),
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
        runShowCommand({ validationRunId: values.validationRunId }, environment),
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
            validationRunId: values.validationRunId,
            reason: values.reason,
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
            validationRunId: values.validationRunId,
            artifactRef: values.artifactRef,
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
        runInitCommand({ taskPrefix: values.taskPrefix }, environment),
      ),
    ),
);
const snapshotCommand = withCliHandler(
  leaf("snapshot", "Create an immutable Shared Repository State Snapshot.", {}),
  (_values, environment) =>
    Effect.promise(() => import("./cli/snapshot.js")).pipe(
      Effect.flatMap(({ runSnapshotCommand }) => runSnapshotCommand(environment)),
    ),
);

const commandRootBase = Command.make("by", {}).pipe(
  Command.withDescription("Validate completed code changes against approved human intent."),
);
const commandRootWithHandler = withCliHandler(commandRootBase, (_values, environment) =>
  dashboardResult(environment),
);
const commandTree = commandRootWithHandler.pipe(
  Command.withSubcommands([
    initCommand,
    snapshotCommand,
    taskCommand,
    taskReviewTopCommand,
    changeCommand,
    validationRunCommand,
  ]),
);

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
                Layer.succeed(CliResultSink, (result) => Ref.set(resultRef, result)),
              ),
            ),
          ),
        ),
      );
    const initialCommandResult = yield* Effect.either(runWithConfig(cliConfig));
    let commandResult = initialCommandResult;
    if (
      initialCommandResult._tag === "Left" &&
      ValidationError.isValidationError(initialCommandResult.left)
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
          return dependencyOptionRequiredErrorResult(missingOperation);
        }
        return usageError({
          code: "invalid_usage",
          message: generatedText(commandResult.left.error),
          help: ["Run `by --help` for generated command help."],
        });
      }
      return yield* Effect.fail(commandResult.left);
    }

    const captured = yield* Ref.get(resultRef);
    if (captured !== undefined) return captured;
    if (helpOutput.length > 0) {
      const nativeOutput = nativeHelpText(helpOutput.join("\n"));
      return success(
        nativeOutput === packageVersion
          ? { version: packageVersion }
          : { help: rootHelpCorrection(nativeOutput) },
      );
    }
    return usageError({
      code: "invalid_usage",
      message: "The command did not produce a result.",
      help: ["Run `by --help` for generated command help."],
    });
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
    if (argument.includes("=")) return undefined;
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
    .replaceAll(/\b(task|task-review|change|validation-run) \1\b/gu, "$1")
    .replaceAll(/\[<task-id>\] (?=(draft|apply) <task-id>)/gu, "");
