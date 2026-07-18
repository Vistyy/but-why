import { existsSync } from "node:fs";

import {
  openCandidateValidationRunInspection,
  type CandidateValidationRunInspectionUseCases,
} from "../candidateValidation/inspectCandidateValidationRun.js";
import { loadRepoLocalContext, type LoadRepoLocalContextError } from "../init/repoContext.js";
import { openRepoLocalStores } from "../init/repoLocalStores.js";

export type LoadCandidateValidationRunInspectionResult =
  | {
      readonly ok: true;
      readonly taskPrefix: string;
      readonly inspection: CandidateValidationRunInspectionUseCases;
    }
  | { readonly ok: false; readonly error: LoadRepoLocalContextError };

export const loadCandidateValidationRunInspection = (input: {
  readonly cwd: string;
  readonly migrationTimestamp: () => string;
}): LoadCandidateValidationRunInspectionResult => {
  const repoContext = loadRepoLocalContext(input.cwd, input.migrationTimestamp);
  if (!repoContext.ok) return repoContext;
  if (!existsSync(repoContext.context.paths.statePath)) {
    return {
      ok: false,
      error: {
        code: "state_store_unavailable",
        taskPrefix: repoContext.context.taskPrefix,
      },
    };
  }

  const stores = openRepoLocalStores(repoContext.context);
  return {
    ok: true,
    taskPrefix: repoContext.context.taskPrefix,
    inspection: openCandidateValidationRunInspection({
      runStore: stores.candidateValidationRunStore,
      candidateStore: stores.candidateStore,
      changeStore: stores.changeStore,
      artifactsRoot: repoContext.context.paths.artifactsPath,
    }),
  };
};
