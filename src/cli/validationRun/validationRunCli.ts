import type { CliResult } from "../../cliResults.js";
import {
  repoStateLoadError,
  runtimeError,
  stateStoreUnavailable,
  success,
  usageError,
} from "../../cliResults.js";
import { withGlobalHelpFlags } from "../../cliHelp.js";
import { loadValidationRunUseCases } from "../../localValidationRun/validationRunUseCases.js";
import type { StructuredObject } from "../../output/structured.js";
import {
  validationRunArtifactView,
  validationRunDetailView,
  validationRunFindingView,
} from "../validationRunViews.js";

export type ValidationRunCommandEnvironment = {
  readonly cwd: string;
  readonly now: () => Date;
};

export const routeValidationRun = (
  args: readonly string[],
  environment: ValidationRunCommandEnvironment,
): CliResult => {
  if (args.length === 1 && args[0] === "--help") {
    return success(validationRunHelpView());
  }

  const subcommand = args[0];

  if (subcommand === "show") {
    return runShowCommand(args.slice(1), environment);
  }

  if (subcommand?.startsWith("-")) {
    return usageError({
      code: "unknown_flag",
      message: `Unknown flag: ${subcommand}`,
      help: ["Run `by validation-run --help`."],
    });
  }

  return usageError({
    code: "unknown_command",
    message: `Unknown validation-run command: ${subcommand ?? ""}`,
    help: ["Run `by validation-run --help`."],
  });
};

const runShowCommand = (
  args: readonly string[],
  environment: ValidationRunCommandEnvironment,
): CliResult => {
  if (args.length === 1 && args[0] === "--help") {
    return success({
      usage: "by validation-run show <validation-run-id>",
      arguments: [
        {
          argument: "<validation-run-id>",
          description: "Validation Run ID, such as by-1-09224d806043.v1",
        },
      ],
      flags: withGlobalHelpFlags(),
      examples: ["by validation-run show by-1-09224d806043.v1"],
    });
  }

  const parseResult = parseValidationRunIdArg(args);

  if (!parseResult.ok) {
    return parseResult.result;
  }

  const validationRunsLoad = loadValidationRunUseCases({
    cwd: environment.cwd,
    requireState: false,
    migrationTimestamp: () => environment.now().toISOString(),
  });

  if (!validationRunsLoad.ok) {
    return repoStateLoadError(validationRunsLoad.error);
  }

  try {
    const details = validationRunsLoad.validationRuns.getValidationRunDetails(
      parseResult.validationRunId,
    );

    if (details === undefined) {
      return validationRunNotFound(parseResult.validationRunId);
    }

    return success({
      validationRun: validationRunDetailView(details.validationRun),
      phases: details.phases,
      rounds: details.rounds,
      findings: details.findings.map(validationRunFindingView),
      toolingFailures: details.toolingFailures,
      artifacts: details.artifacts.map(validationRunArtifactView),
    });
  } catch {
    return stateStoreUnavailable(validationRunsLoad.taskPrefix);
  }
};

const validationRunHelpView = (): StructuredObject => ({
  usage: "by validation-run <command> [--help]",
  commands: [
    {
      command: "by validation-run show <validation-run-id>",
      description: "Show full Validation Run details",
    },
  ],
  flags: withGlobalHelpFlags(),
});

type ValidationRunIdArgResult =
  | {
      readonly ok: true;
      readonly validationRunId: string;
    }
  | {
      readonly ok: false;
      readonly result: CliResult;
    };

const parseValidationRunIdArg = (args: readonly string[]): ValidationRunIdArgResult => {
  const validationRunId = args[0];

  if (validationRunId === undefined) {
    return {
      ok: false,
      result: usageError({
        code: "missing_validation_run_id",
        message: "Validation Run ID is required.",
        help: ["Run `by validation-run show <validation-run-id>`."],
      }),
    };
  }

  if (validationRunId.startsWith("-")) {
    return {
      ok: false,
      result: usageError({
        code: "missing_validation_run_id",
        message: "Validation Run ID is required.",
        help: ["Run `by validation-run show <validation-run-id>`."],
      }),
    };
  }

  if (args.length > 1) {
    return {
      ok: false,
      result: usageError({
        code: "unexpected_argument",
        message: `Unexpected argument: ${args[1] ?? ""}`,
        help: ["Run `by validation-run show <validation-run-id>`."],
      }),
    };
  }

  return { ok: true, validationRunId };
};

const validationRunNotFound = (validationRunId: string): CliResult =>
  runtimeError({
    code: "validation_run_not_found",
    message: `Validation Run was not found: ${validationRunId}`,
    details: { validationRunId },
    help: ["Run `by task validation-runs <task-id>` to see known Validation Runs."],
  });
