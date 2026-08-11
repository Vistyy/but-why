// fallow-ignore-file unused-export duplicate-export -- dynamically loaded command owner

import { Effect } from "effect";
import { loadCandidateValidationRunInspection } from "../../change/candidateValidation/composition/loadCandidateValidationRunInspection.js";
import type { CliResult } from "../../cliResults.js";
import {
  repoStateLoadError,
  repositoryStorageErrorResult,
  runtimeError,
  stateStoreUnavailable,
  success,
} from "../../cliResults.js";
import { candidateValidationArtifactContentView } from "../validationRunViews.js";
import { notFound, type ValidationRunCommandEnvironment } from "./validationRunSupport.js";

const artifactFailure = (code: string, id: string, ref: string): CliResult =>
  code === "validation_run_not_found"
    ? notFound(id)
    : runtimeError({
        code,
        message:
          code === "artifact_not_found"
            ? `Artifact was not found: ${ref}`
            : `Artifact metadata exists, but its stored content is unavailable: ${ref}`,
        details: { validationRunId: id, artifactRef: ref },
        help: [
          code === "artifact_not_found"
            ? `Run \`by validation-run show ${id}\` to list known Artifacts.`
            : `Run \`by validation-run show ${id}\` to inspect the recorded metadata.`,
        ],
      });
export const runArtifactCommand = (
  command: { readonly validationRunId: string; readonly artifactRef: string },
  environment: ValidationRunCommandEnvironment,
): Effect.Effect<CliResult> => {
  const loaded = loadCandidateValidationRunInspection({ cwd: environment.cwd });
  if (!loaded.ok) return Effect.succeed(repoStateLoadError(loaded.error));
  return loaded.inspection.readArtifact(command.validationRunId, command.artifactRef).pipe(
    Effect.map((result) =>
      result.ok
        ? success(candidateValidationArtifactContentView(result.artifact, result.content))
        : artifactFailure(result.code, command.validationRunId, command.artifactRef),
    ),
    Effect.catchAll((error) => Effect.succeed(repositoryStorageErrorResult(error))),
    Effect.catchAllCause(() => Effect.succeed(stateStoreUnavailable(loaded.taskPrefix))),
  );
};
