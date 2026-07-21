import { existsSync } from "node:fs";

import { Effect } from "effect";

import type { ReviewerAgentRuntime } from "../agent/reviewerAgentRuntime.js";
import { resolveCandidateValidationPolicy } from "../candidateValidation/resolveCandidateValidationPolicy.js";
import { openChangeCandidateCapture } from "../changeCandidateCapture/captureLocalCandidate.js";
import type { ChangeCandidateCapturePersistence } from "../changeCandidateCapture/changeCandidateCapturePersistence.js";
import { localChangeCandidateCaptureGit } from "../changeCandidateCapture/localGitCandidate.js";
import { cleanupChangeResources } from "../change/localChangeCleanupGit.js";
import { openChangeReconciliation } from "../change/reconcileChange.js";
import {
  openChangeSubmit,
  type ChangeSubmit,
  type ChangeSubmitResult,
} from "../change/submitChange.js";
import { openRepoLocalStores } from "../init/repoLocalStores.js";
import { loadRepoLocalContext, type LoadRepoLocalContextError } from "../init/repoContext.js";
import { localCandidateValidationLayer } from "../localCandidateValidation/localCandidateValidationLayer.js";
import { localCandidatePublicationGit } from "../publication/localCandidatePublicationGit.js";
import type { RepositoryStorageError } from "../repositoryStorageError.js";
import { repositorySqlLayer } from "../sqlite/repositorySql.js";
import { openSqliteChangeCandidateCapturePersistence } from "../sqlite/sqliteChangeCandidateCapturePersistence.js";
import { openCandidatePublication } from "../publication/publishCandidate.js";
import { detectGitHubPrTarget } from "../submissionEnvironment/githubTarget.js";
import { localGitHubPullRequestGateway } from "../submissionEnvironment/localGitHubPullRequestGateway.js";

export type LoadChangeSubmitResult =
  | { readonly ok: true; readonly submit: ChangeSubmit }
  | {
      readonly ok: false;
      readonly error:
        | LoadRepoLocalContextError
        | { readonly code: "state_store_unavailable"; readonly taskPrefix: string };
    };

export const loadChangeSubmit = (input: {
  readonly cwd: string;
  readonly globalConfigPath: string;
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime;
}): LoadChangeSubmitResult => {
  const repoContext = loadRepoLocalContext(input.cwd);
  if (!repoContext.ok) return repoContext;
  const context = repoContext.context;
  if (!existsSync(context.paths.statePath)) {
    return {
      ok: false,
      error: { code: "state_store_unavailable", taskPrefix: context.taskPrefix },
    };
  }

  const stores = openRepoLocalStores(context);
  const reconciliation = openChangeReconciliation({
    changeStore: stores.changeStore,
    github: localGitHubPullRequestGateway({ cwd: context.root }),
    cleanup: cleanupChangeResources,
  });
  const programFor = (persistence: ChangeCandidateCapturePersistence) =>
    openChangeSubmit({
      repositoryCommonDirectory: context.commonDirectory,
      changeStore: stores.changeStore,
      taskStore: stores.taskStore,
      validationRunStore: stores.candidateValidationRunStore,
      reconciliation,
      resolvePolicy: (taskBacked) =>
        resolveCandidateValidationPolicy({
          context,
          globalConfigPath: input.globalConfigPath,
          taskBacked,
        }),
      publicationFor: (cwd) =>
        openCandidatePublication({
          changeStore: stores.changeStore,
          candidateStore: stores.candidateStore,
          validationRunStore: stores.candidateValidationRunStore,
          git: localCandidatePublicationGit({ cwd }),
          github: localGitHubPullRequestGateway({ cwd }),
        }),
      detectTarget: detectGitHubPrTarget,
      captureCandidate: openChangeCandidateCapture({
        persistence,
        git: localChangeCandidateCaptureGit,
      }).capture,
    });
  const layer = localCandidateValidationLayer({
    localRepositoryMainCheckoutRoot: context.root,
    artifactsRoot: context.paths.artifactsPath,
    runStore: stores.candidateValidationRunStore,
    ...(input.reviewerAgentRuntime === undefined
      ? {}
      : { reviewerAgentRuntime: input.reviewerAgentRuntime }),
  });

  const repositoryLayer = repositorySqlLayer({
    statePath: context.paths.statePath,
    commonDirectory: context.commonDirectory,
  });

  return {
    ok: true,
    submit: {
      submit: (submitInput): Effect.Effect<ChangeSubmitResult, RepositoryStorageError> =>
        Effect.flatMap(openSqliteChangeCandidateCapturePersistence(), (persistence) =>
          programFor(persistence).submit(submitInput),
        ).pipe(Effect.provide(layer), Effect.provide(repositoryLayer)),
    },
  };
};
