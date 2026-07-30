import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { Effect } from "effect";

import { runCommandTree } from "./cliCommandTree.js";
import { runtimeError, success, type CliResult, usageError } from "./cliResults.js";
import { initRepoLocalContext } from "./init/repoContext.js";
import { structuredContractDiagnostics } from "./output/contractDiagnostics.js";
import type { OutputFormat } from "./output/structured.js";
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

export const runCli = (
  args: readonly string[],
  environment: CliEnvironment,
): Effect.Effect<CliResult> => runCommandTree(args, environment, routeCommandArgs);

const routeCommandArgs = (
  args: readonly string[],
  environment: CliEnvironment,
): Effect.Effect<CliResult> => {
  const bin = collapseHome(environment.executablePath);

  if (args.length === 0) {
    return dashboard(bin, description, environment);
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

const routeInit = (
  args: readonly string[],
  environment: CliEnvironment,
): Effect.Effect<CliResult> => {
  const docs = publicDocs(environment);

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
