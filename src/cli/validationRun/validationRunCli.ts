import { Effect } from "effect";

import { withGlobalHelpFlags } from "../../cliHelp.js";
import type { CliResult } from "../../cliResults.js";
import {
  repoStateLoadError,
  repositoryStorageErrorResult,
  runtimeError,
  stateStoreUnavailable,
  success,
  usageError,
} from "../../cliResults.js";
import { loadCandidateValidationRunInspection } from "../../localCandidateValidation/candidateValidationRunInspection.js";
import type { StructuredObject } from "../../output/structured.js";
import {
  candidateValidationArtifactContentView,
  candidateValidationRunInspectionView,
} from "../validationRunViews.js";

export type ValidationRunCommandEnvironment = {
  readonly cwd: string;
  readonly now: () => Date;
};

export const routeValidationRun = (
  args: readonly string[],
  environment: ValidationRunCommandEnvironment,
): Effect.Effect<CliResult> => {
  if (args.length === 1 && args[0] === "--help") {
    return Effect.succeed(success(validationRunHelpView()));
  }

  const subcommand = args[0];
  if (subcommand === "show") return runShowCommand(args.slice(1), environment);
  if (subcommand === "artifact") return runArtifactCommand(args.slice(1), environment);

  if (subcommand?.startsWith("-")) {
    return Effect.succeed(
      usageError({
        code: "unknown_flag",
        message: `Unknown flag: ${subcommand}`,
        help: ["Run `by validation-run --help`."],
      }),
    );
  }

  return Effect.succeed(
    usageError({
      code: "unknown_command",
      message: `Unknown validation-run command: ${subcommand ?? ""}`,
      help: ["Run `by validation-run --help`."],
    }),
  );
};

const runShowCommand = (
  args: readonly string[],
  environment: ValidationRunCommandEnvironment,
): Effect.Effect<CliResult> => {
  if (args.length === 1 && args[0] === "--help") {
    return Effect.succeed(
      success({
        usage: "by validation-run show <validation-run-id>",
        arguments: [
          {
            argument: "<validation-run-id>",
            description: "Validation Run ID owned by a Candidate.",
          },
        ],
        flags: withGlobalHelpFlags(),
        examples: ["by validation-run show <validation-run-id>"],
      }),
    );
  }

  const parseResult = parseExactArgs(args, ["validationRunId"]);
  if (!parseResult.ok) return Effect.succeed(parseResult.result);
  const validationRunId = parseResult.values[0] ?? "";
  const inspectionLoad = loadInspection(environment);
  if (!inspectionLoad.ok) return Effect.succeed(repoStateLoadError(inspectionLoad.error));

  return inspectionLoad.inspection.inspectRun(validationRunId).pipe(
    Effect.map((inspection) =>
      inspection === undefined
        ? validationRunNotFound(validationRunId)
        : success(candidateValidationRunInspectionView(inspection)),
    ),
    Effect.catchAll((error) => Effect.succeed(repositoryStorageErrorResult(error))),
    Effect.catchAllCause(() => Effect.succeed(stateStoreUnavailable(inspectionLoad.taskPrefix))),
  );
};

const runArtifactCommand = (
  args: readonly string[],
  environment: ValidationRunCommandEnvironment,
): Effect.Effect<CliResult> => {
  if (args.length === 1 && args[0] === "--help") {
    return Effect.succeed(
      success({
        usage: "by validation-run artifact <validation-run-id> <artifact-ref>",
        arguments: [
          {
            argument: "<validation-run-id>",
            description: "Validation Run ID owned by a Candidate.",
          },
          {
            argument: "<artifact-ref>",
            description: "Artifact reference returned by Validation Run inspection.",
          },
        ],
        flags: withGlobalHelpFlags(),
        examples: [
          "by validation-run artifact <validation-run-id> artifact:<validation-run-id>/checks/<check-id>/stdout.txt",
        ],
      }),
    );
  }

  const parseResult = parseExactArgs(args, ["validationRunId", "artifactRef"]);
  if (!parseResult.ok) return Effect.succeed(parseResult.result);
  const validationRunId = parseResult.values[0] ?? "";
  const artifactRef = parseResult.values[1] ?? "";
  const inspectionLoad = loadInspection(environment);
  if (!inspectionLoad.ok) return Effect.succeed(repoStateLoadError(inspectionLoad.error));

  return inspectionLoad.inspection.readArtifact(validationRunId, artifactRef).pipe(
    Effect.map((result) => {
      if (result.ok)
        return success(candidateValidationArtifactContentView(result.artifact, result.content));

      return artifactReadFailure(result.code, validationRunId, artifactRef);
    }),
    Effect.catchAll((error) => Effect.succeed(repositoryStorageErrorResult(error))),
    Effect.catchAllCause(() => Effect.succeed(stateStoreUnavailable(inspectionLoad.taskPrefix))),
  );
};

const loadInspection = (environment: ValidationRunCommandEnvironment) =>
  loadCandidateValidationRunInspection({
    cwd: environment.cwd,
  });

const validationRunHelpView = (): StructuredObject => ({
  usage: "by validation-run <command> [--help]",
  commands: [
    {
      command: "by validation-run show <validation-run-id>",
      description: "Show one Candidate-owned Validation Run and its evidence.",
    },
    {
      command: "by validation-run artifact <validation-run-id> <artifact-ref>",
      description: "Show stored Artifact content.",
    },
  ],
  flags: withGlobalHelpFlags(),
});

type ParsedArgs =
  | { readonly ok: true; readonly values: readonly string[] }
  | { readonly ok: false; readonly result: CliResult };

const parseExactArgs = (args: readonly string[], names: readonly string[]): ParsedArgs => {
  const missingIndex = names.findIndex(
    (_, index) => args[index] === undefined || args[index]?.startsWith("-"),
  );
  if (missingIndex !== -1) {
    const name = names[missingIndex] ?? "argument";
    return {
      ok: false,
      result: usageError({
        code: `missing_${snakeCase(name)}`,
        message: `${titleCase(name)} is required.`,
        help: [commandUsage(names)],
      }),
    };
  }
  if (args.length > names.length) {
    return {
      ok: false,
      result: usageError({
        code: "unexpected_argument",
        message: `Unexpected argument: ${args[names.length] ?? ""}`,
        help: [commandUsage(names)],
      }),
    };
  }
  return { ok: true, values: args };
};

const commandUsage = (names: readonly string[]): string =>
  names.length === 1
    ? "Run `by validation-run show <validation-run-id>`."
    : "Run `by validation-run artifact <validation-run-id> <artifact-ref>`.";

const snakeCase = (value: string): string =>
  value.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const titleCase = (value: string): string =>
  value.replace(/^[a-z]/, (letter) => letter.toUpperCase()).replaceAll(/([A-Z])/g, " $1");

const validationRunNotFound = (validationRunId: string): CliResult =>
  runtimeError({
    code: "validation_run_not_found",
    message: `Validation Run was not found: ${validationRunId}`,
    details: { validationRunId },
    help: ["Run `by change show <change-id>` to inspect known Candidates and Validation Runs."],
  });

const artifactReadFailure = (
  code: "validation_run_not_found" | "artifact_not_found" | "artifact_content_unavailable",
  validationRunId: string,
  artifactRef: string,
): CliResult =>
  ({
    validation_run_not_found: validationRunNotFound(validationRunId),
    artifact_not_found: artifactNotFound(validationRunId, artifactRef),
    artifact_content_unavailable: artifactContentUnavailable(validationRunId, artifactRef),
  })[code];

const artifactNotFound = (validationRunId: string, artifactRef: string): CliResult =>
  runtimeError({
    code: "artifact_not_found",
    message: `Artifact was not found: ${artifactRef}`,
    details: { validationRunId, artifactRef },
    help: [`Run \`by validation-run show ${validationRunId}\` to list known Artifacts.`],
  });

const artifactContentUnavailable = (validationRunId: string, artifactRef: string): CliResult =>
  runtimeError({
    code: "artifact_content_unavailable",
    message: `Artifact metadata exists, but its stored content is unavailable: ${artifactRef}`,
    details: { validationRunId, artifactRef },
    help: [`Run \`by validation-run show ${validationRunId}\` to inspect the recorded metadata.`],
  });
