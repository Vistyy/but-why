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
import { candidateValidationRunInspectionView } from "../validationRunViews.js";
export type ValidationRunCommandEnvironment = { readonly cwd: string; readonly now: () => Date };
const notFound = (id: string): CliResult =>
  runtimeError({
    code: "validation_run_not_found",
    message: `Validation Run was not found: ${id}`,
    details: { validationRunId: id },
    help: ["Run `by change show <change-id>` to inspect known Candidates and Validation Runs."],
  });
export const runShowCommand = (
  command: { readonly validationRunId: string },
  environment: ValidationRunCommandEnvironment,
): Effect.Effect<CliResult> => {
  const loaded = loadCandidateValidationRunInspection({ cwd: environment.cwd });
  if (!loaded.ok) return Effect.succeed(repoStateLoadError(loaded.error));
  return loaded.inspection.inspectRun(command.validationRunId).pipe(
    Effect.map((inspection) =>
      inspection === undefined
        ? notFound(command.validationRunId)
        : success(candidateValidationRunInspectionView(inspection)),
    ),
    Effect.catchAll((error) => Effect.succeed(repositoryStorageErrorResult(error))),
    Effect.catchAllCause(() => Effect.succeed(stateStoreUnavailable(loaded.taskPrefix))),
  );
};
