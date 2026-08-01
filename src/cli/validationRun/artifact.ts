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
import { candidateValidationArtifactContentView } from "../validationRunViews.js";
export type ValidationRunCommandEnvironment = { readonly cwd: string; readonly now: () => Date };
const notFound = (id: string): CliResult =>
  runtimeError({
    code: "validation_run_not_found",
    message: `Validation Run was not found: ${id}`,
    details: { validationRunId: id },
    help: ["Run `by change show <change-id>` to inspect known Candidates and Validation Runs."],
  });
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
        help: [`Run \`by validation-run show ${id}\` to inspect the recorded metadata.`],
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
