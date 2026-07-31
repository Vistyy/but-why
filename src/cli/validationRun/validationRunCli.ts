import { Effect } from "effect";

import type { CliResult } from "../../cliResults.js";
import {
  repoStateLoadError,
  repositoryStorageErrorResult,
  runtimeError,
  stateStoreUnavailable,
  success,
} from "../../cliResults.js";
import { loadCandidateValidationRunInspection } from "../../change/candidateValidation/loadCandidateValidationRunInspection.js";
import {
  candidateValidationArtifactContentView,
  candidateValidationRunInspectionView,
} from "../validationRunViews.js";

export type ValidationRunCommandEnvironment = {
  readonly cwd: string;
  readonly now: () => Date;
};

export const runShowCommand = (
  command: { readonly validationRunId: string },
  environment: ValidationRunCommandEnvironment,
): Effect.Effect<CliResult> => {
  const inspectionLoad = loadInspection(environment);
  if (!inspectionLoad.ok) return Effect.succeed(repoStateLoadError(inspectionLoad.error));

  return inspectionLoad.inspection.inspectRun(command.validationRunId).pipe(
    Effect.map((inspection) =>
      inspection === undefined
        ? validationRunNotFound(command.validationRunId)
        : success(candidateValidationRunInspectionView(inspection)),
    ),
    Effect.catchAll((error) => Effect.succeed(repositoryStorageErrorResult(error))),
    Effect.catchAllCause(() => Effect.succeed(stateStoreUnavailable(inspectionLoad.taskPrefix))),
  );
};

export const runArtifactCommand = (
  command: { readonly validationRunId: string; readonly artifactRef: string },
  environment: ValidationRunCommandEnvironment,
): Effect.Effect<CliResult> => {
  const inspectionLoad = loadInspection(environment);
  if (!inspectionLoad.ok) return Effect.succeed(repoStateLoadError(inspectionLoad.error));

  return inspectionLoad.inspection.readArtifact(command.validationRunId, command.artifactRef).pipe(
    Effect.map((result) => {
      if (result.ok) {
        return success(candidateValidationArtifactContentView(result.artifact, result.content));
      }

      return artifactReadFailure(result.code, command.validationRunId, command.artifactRef);
    }),
    Effect.catchAll((error) => Effect.succeed(repositoryStorageErrorResult(error))),
    Effect.catchAllCause(() => Effect.succeed(stateStoreUnavailable(inspectionLoad.taskPrefix))),
  );
};

const loadInspection = (environment: ValidationRunCommandEnvironment) =>
  loadCandidateValidationRunInspection({
    cwd: environment.cwd,
  });

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
