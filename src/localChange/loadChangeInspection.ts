import { existsSync } from "node:fs";

import { openChangeInspection, type ChangeInspection } from "../change/inspectChange.js";
import { loadRepoLocalContext, type LoadRepoLocalContextError } from "../init/repoContext.js";
import { openRepoLocalStores } from "../init/repoLocalStores.js";

export type LoadChangeInspectionResult =
  | {
      readonly ok: true;
      readonly commonDirectory: string;
      readonly inspection: ChangeInspection;
    }
  | { readonly ok: false; readonly error: LoadRepoLocalContextError };

export const loadChangeInspection = (input: {
  readonly cwd: string;
}): LoadChangeInspectionResult => {
  const repoContext = loadRepoLocalContext(input.cwd);
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
    commonDirectory: repoContext.context.commonDirectory,
    inspection: openChangeInspection({
      changeStore: stores.changeStore,
      candidateStore: stores.candidateStore,
      runStore: stores.candidateValidationRunStore,
    }),
  };
};
