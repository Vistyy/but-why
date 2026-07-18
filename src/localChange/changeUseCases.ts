import { existsSync } from "node:fs";

import { openChangeUseCases, type ChangeUseCases } from "../change/changeUseCases.js";
import { openRepoLocalStores } from "../init/repoLocalStores.js";
import { executeLocalRepositoryPreparation } from "../repositoryPreparation/localRepositoryPreparation.js";
import { loadRepoLocalContext, type LoadRepoLocalContextError } from "../init/repoContext.js";

export type LoadChangeUseCasesResult =
  | { readonly ok: true; readonly changes: ChangeUseCases }
  | {
      readonly ok: false;
      readonly error:
        | LoadRepoLocalContextError
        | { readonly code: "state_store_unavailable"; readonly taskPrefix: string };
    };

export const loadChangeUseCases = (input: {
  readonly cwd: string;
  readonly migrationTimestamp: () => string;
}): LoadChangeUseCasesResult => {
  const repoContext = loadRepoLocalContext(input.cwd, input.migrationTimestamp);
  if (!repoContext.ok) return repoContext;
  if (!existsSync(repoContext.context.paths.statePath)) {
    return {
      ok: false,
      error: { code: "state_store_unavailable", taskPrefix: repoContext.context.taskPrefix },
    };
  }
  const stores = openRepoLocalStores(repoContext.context);
  return {
    ok: true,
    changes: openChangeUseCases(
      repoContext.context,
      stores.changeStartStore,
      executeLocalRepositoryPreparation,
    ),
  };
};
