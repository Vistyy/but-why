import { existsSync } from "node:fs";

import { openHerdrInteractiveSessionHost } from "../change/herdrInteractiveSessionHost.js";
import type { InteractiveSessionHost } from "../change/interactiveSessionHost.js";
import { cleanupChangeResources } from "../change/localChangeCleanupGit.js";
import { openChangeReconciliation } from "../change/reconcileChange.js";
import { openChangeUseCases, type ChangeUseCases } from "../change/changeUseCases.js";
import { openRepoLocalStores } from "../init/repoLocalStores.js";
import { executeLocalRepositoryPreparation } from "../repositoryPreparation/localRepositoryPreparation.js";
import { loadRepoLocalContext, type LoadRepoLocalContextError } from "../init/repoContext.js";
import { localGitHubPullRequestGateway } from "../submissionEnvironment/localGitHubPullRequestGateway.js";

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
  readonly interactiveSessionHost?: InteractiveSessionHost;
  readonly interactiveSessionPath?: string;
}): LoadChangeUseCasesResult => {
  const repoContext = loadRepoLocalContext(input.cwd);
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
      openChangeReconciliation({
        changeStore: stores.changeStore,
        github: localGitHubPullRequestGateway(),
        cleanup: cleanupChangeResources,
      }),
      input.interactiveSessionHost ??
        openHerdrInteractiveSessionHost(undefined, {
          ...(input.interactiveSessionPath === undefined
            ? {}
            : { path: input.interactiveSessionPath }),
        }),
    ),
  };
};
