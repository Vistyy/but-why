import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { Effect, Schema } from "effect";

import { withGlobalHelpFlags } from "./cliHelp.js";
import { selectOutput } from "./cliOutputSelection.js";
import { runtimeError, success, type CliResult, usageError } from "./cliResults.js";
import { initRepoLocalContext } from "./init/repoContext.js";
import { structuredContractDiagnostics } from "./output/contractDiagnostics.js";
import type { OutputFormat, StructuredObject } from "./output/structured.js";
import { routeChange } from "./cli/change/changeCli.js";
import { dashboard } from "./cli/task/dashboard.js";
import { routeTask } from "./cli/task/taskCli.js";
import { routeValidationRun } from "./cli/validationRun/validationRunCli.js";
import type { InteractiveSessionHost } from "./change/interactiveSessionHost.js";
import type { ReviewerAgentRuntime } from "./agent/reviewerAgentRuntime.js";
import type { TaskUseCases } from "./task/taskUseCases.js";
import type { CancellationUseCases } from "./change/cancelChange.js";
import type { TextInputStdin } from "./cli/input/textInput.js";

export type { CliResult } from "./cliResults.js";

export type CliEnvironment = {
  readonly executablePath: string;
  readonly cwd: string;
  readonly globalConfigPath: string;
  readonly now: () => Date;
  readonly stdin: TextInputStdin;
  readonly taskUseCases?: TaskUseCases;
  readonly cancellationUseCases?: CancellationUseCases;
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime;
  readonly interactiveSessionHost?: InteractiveSessionHost;
  readonly interactiveSessionPath?: string;
};

const description = "Validate completed code changes against approved human intent.";

const docsSchema = Schema.Array(
  Schema.Struct({
    name: Schema.String,
    path: Schema.String,
  }),
);

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
  docs: docsSchema,
});

export const runCli = (
  args: readonly string[],
  environment: CliEnvironment,
): Effect.Effect<CliResult> => routeArgs(args, environment);

const routeArgs = (
  args: readonly string[],
  environment: CliEnvironment,
): Effect.Effect<CliResult> => {
  const outputSelection = selectOutput(args);

  if (!outputSelection.ok) {
    return Effect.succeed({ ...outputSelection.result, outputFormat: "toon" });
  }

  return Effect.map(routeCommandArgs(outputSelection.args, environment), (result) => ({
    ...result,
    outputFormat: outputSelection.outputFormat,
  }));
};

const routeCommandArgs = (
  args: readonly string[],
  environment: CliEnvironment,
): Effect.Effect<CliResult> => {
  const bin = collapseHome(environment.executablePath);

  if (args.length === 0) {
    return dashboard(bin, description, environment);
  }

  if (args.length === 1 && args[0] === "--help") {
    return Effect.succeed(success(helpView(bin, publicDocs(environment))));
  }

  const firstArg = args[0];

  if (firstArg === "init") {
    return routeInit(args.slice(1), environment);
  }

  if (firstArg === "task") {
    return routeTask(args.slice(1), environment, { bin, description });
  }

  if (firstArg === "change") {
    return routeChange(args.slice(1), environment);
  }

  if (firstArg === "validation-run") {
    return routeValidationRun(args.slice(1), environment);
  }

  if (firstArg?.startsWith("-")) {
    return Effect.succeed(
      usageError({
        code: "unknown_flag",
        message: `Unknown flag: ${firstArg}`,
        help: ["Run `by --help`"],
      }),
    );
  }

  return Effect.succeed(
    usageError({
      code: "unknown_command",
      message: `Unknown command: ${firstArg ?? ""}`,
      help: ["Run `by --help`"],
    }),
  );
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

type PublicDocs = {
  readonly setup: string;
  readonly config: string;
};

const publicDocs = (environment: CliEnvironment): PublicDocs => {
  const executablePath = realExecutablePath(environment.executablePath);
  const packageRoot = resolve(dirname(executablePath), "..");

  return {
    setup: join(packageRoot, "docs/public/setup.md"),
    config: join(packageRoot, "docs/public/config.md"),
  };
};

const realExecutablePath = (executablePath: string): string => {
  try {
    return realpathSync(executablePath);
  } catch {
    return resolve(executablePath);
  }
};

const publicDocsList = (docs: PublicDocs) => [
  { name: "setup", path: docs.setup },
  { name: "config", path: docs.config },
];

const validationSetupGuidance = (docs: PublicDocs) => ({
  policyFile: ".but-why/config.json",
  policy: "tracked repo policy",
  configDoc: docs.config,
  setupDoc: docs.setup,
  guidance: [
    { step: "inspect", detail: "Inspect repo tooling before choosing validation commands." },
    {
      step: "configure",
      detail:
        "Configure top-level prepare and validation.checks to the best of your ability from observed tooling.",
    },
    { step: "review", detail: "Keep .but-why/config.json explicit and reviewable." },
  ],
});

const helpView = (bin: string, docs: PublicDocs): StructuredObject =>
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
        command:
          "by task create --title <title> --description-file <file> [--depends-on <task-id>]...",
        description: "Create a repo-local Task",
      },
      {
        command: "by task dependencies set <task-id> [--depends-on <task-id>]...",
        description: "Replace direct Task prerequisites before Start",
      },
      {
        command: "by task list [--all] [--state <state>]",
        description: "List repo-local Tasks",
      },
      {
        command: "by task show <task-id>",
        description: "Show decision-oriented Task metadata; use Task Context for the description",
      },
      {
        command: "by task approve <task-id>",
        description: "Permanently approve Task intent",
      },
      {
        command: "by task context <task-id>",
        description: "Show full Task Context",
      },
      {
        command: "by task cancel <task-id> --reason <reason>",
        description: "Permanently cancel an unfinished Task",
      },
      {
        command: "by change start [--task <task-id>] [--base <branch>]",
        description: "Create a prepared Change worktree",
      },
      {
        command: "by change prepare <change-id>",
        description: "Run or retry Repository Preparation",
      },
      {
        command: "by change list [--all]",
        description: "List Changes oldest first",
      },
      {
        command: "by change show <change-id>",
        description: "Show decision-oriented Change state and expansion commands",
      },
      {
        command: "by change findings <change-id>",
        description: "Show Findings for the current Change Candidate",
      },
      {
        command: "by change validation-runs <change-id>",
        description: "List complete compact Validation Run History and expansion commands",
      },
      {
        command: "by change submit <change-id>",
        description: "Validate and publish a ready Change",
      },
      {
        command: "by change cancel <change-id>",
        description: "Cancel an open taskless Change",
      },
      {
        command: "by change reconcile [<change-id>]",
        description: "Read owned pull requests and clean up terminal Changes",
      },
      {
        command: "by change implement <change-id> [--handoff-file <path>]",
        description: "Launch an Interactive Session in a ready Change worktree",
      },
      {
        command: "by validation-run show <validation-run-id>",
        description: "Show Validation Run policy and recorded evidence",
      },
      {
        command: "by validation-run artifact <validation-run-id> <artifact-ref>",
        description: "Show complete stored Artifact content",
      },
    ],
    flags: withGlobalHelpFlags(),
    docs: publicDocsList(docs),
  });

const routeInit = (
  args: readonly string[],
  environment: CliEnvironment,
): Effect.Effect<CliResult> => {
  const docs = publicDocs(environment);

  if (args.length === 1 && args[0] === "--help") {
    return Effect.succeed(
      success({
        usage: "by init --task-prefix <prefix>",
        description: "Create repo policy files and then guide validation setup.",
        flags: withGlobalHelpFlags([
          {
            flag: "--task-prefix <prefix>",
            description: "Required task ID prefix such as BY",
          },
        ]),
        examples: ["by init --task-prefix BY"],
        docs: publicDocsList(docs),
      }),
    );
  }

  const parseResult = parseInitArgs(args);

  if (!parseResult.ok) {
    return Effect.succeed(parseResult.result);
  }

  const taskPrefix = parseResult.taskPrefix;

  if (taskPrefix === undefined) {
    return Effect.succeed(
      usageError({
        code: "missing_task_prefix",
        message: "--task-prefix is required in non-interactive init.",
        help: ["Run by init --task-prefix BY."],
      }),
    );
  }

  return initRepoLocalContext({
    cwd: environment.cwd,
    taskPrefix,
  }).pipe(
    Effect.map((initResult) => {
      if (!initResult.ok) {
        switch (initResult.error.code) {
          case "invalid_task_prefix":
            return usageError({
              code: "invalid_task_prefix",
              message: "Task prefix must match ^[A-Z][A-Z0-9]{1,9}$.",
              details: { taskPrefix: initResult.error.taskPrefix },
              help: [
                "Use 2 to 10 uppercase letters or digits, starting with a letter, such as BY.",
              ],
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
              message: initResult.error.error.message,
              details: {
                path: initResult.error.error.path ?? ".but-why/config.json",
                diagnostics: structuredContractDiagnostics(initResult.error.error.diagnostics),
              },
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
          case "shared_state_identity_conflict":
            return runtimeError({
              code: "shared_state_identity_conflict",
              message: "Shared But Why? state belongs to a different Git repository.",
              help: [
                "Restore the repository's own shared state, then run `by init --task-prefix <prefix>`.",
              ],
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
        validationSetup: validationSetupGuidance(docs),
      });
    }),
  );
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
