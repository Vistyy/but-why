import { existsSync } from "node:fs";

import { openRepoLocalStores } from "../init/repoLocalStores.js";
import { loadRepoLocalContext, type LoadRepoLocalContextError } from "../init/repoContext.js";
import {
  openValidationRunUseCases,
  type ValidationRunUseCases,
} from "../validationRun/validationRunUseCases.js";

export type LoadValidationRunUseCasesInput = {
  readonly cwd: string;
  readonly requireState: boolean;
  readonly migrationTimestamp: () => string;
};

export type LoadValidationRunUseCasesResult =
  | {
      readonly ok: true;
      readonly taskPrefix: string;
      readonly validationRuns: ValidationRunUseCases;
    }
  | {
      readonly ok: false;
      readonly error: LoadValidationRunUseCasesError;
    };

export type LoadValidationRunUseCasesError =
  | LoadRepoLocalContextError
  | {
      readonly code: "state_store_unavailable";
      readonly taskPrefix: string;
    };

export const loadValidationRunUseCases = (
  input: LoadValidationRunUseCasesInput,
): LoadValidationRunUseCasesResult => {
  const repoContext = loadRepoLocalContext(input.cwd, input.migrationTimestamp);

  if (!repoContext.ok) {
    return repoContext;
  }

  if (input.requireState && !existsSync(repoContext.context.paths.statePath)) {
    return {
      ok: false,
      error: {
        code: "state_store_unavailable",
        taskPrefix: repoContext.context.taskPrefix,
      },
    };
  }

  const { validationRunStore } = openRepoLocalStores(repoContext.context);

  return {
    ok: true,
    taskPrefix: repoContext.context.taskPrefix,
    validationRuns: openValidationRunUseCases({ validationRunStore }),
  };
};
