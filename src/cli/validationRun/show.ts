// fallow-ignore-file unused-export duplicate-export -- dynamically loaded command owner

import { Effect } from "effect";
import { loadCandidateValidationRunInspection } from "../../change/candidateValidation/composition/loadCandidateValidationRunInspection.js";
import type { CliResult } from "../../cliResults.js";
import {
  repoStateLoadError,
  repositoryStorageErrorResult,
  stateStoreUnavailable,
  success,
} from "../../cliResults.js";
import { candidateValidationRunInspectionView } from "../validationRunViews.js";
import { notFound, type ValidationRunCommandEnvironment } from "./validationRunSupport.js";
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
    Effect.catchAllCause(() => Effect.succeed(stateStoreUnavailable(loaded.idPrefix))),
  );
};
