import { existsSync } from "node:fs";

import { Effect } from "effect";

import type { ReviewerAgentRuntime } from "../agent/reviewerAgentRuntime.js";
import { resolveCandidateValidationPolicy } from "../candidateValidation/resolveCandidateValidationPolicy.js";
import { openChangeCandidateCapture } from "../changeCandidateCapture/captureLocalCandidate.js";
import type { ChangeCandidateCapturePersistence } from "../changeCandidateCapture/changeCandidateCapturePersistence.js";
import type { ChangeValidationPersistence } from "../changeValidation/changeValidationPersistence.js";
import { localChangeCandidateCaptureGit } from "../changeCandidateCapture/localGitCandidate.js";
import { cleanupChangeResources } from "../change/localChangeCleanupGit.js";
import { openChangeReconciliation } from "../change/reconcileChange.js";
import {
  openChangeSubmit,
  type ChangeSubmit,
  type ChangeSubmitResult,
} from "../change/submitChange.js";
import { loadRepoLocalContext, type LoadRepoLocalContextError } from "../init/repoContext.js";
import { localCandidateValidationLayer } from "../localCandidateValidation/localCandidateValidationLayer.js";
import { localCandidatePublicationGit } from "../publication/localCandidatePublicationGit.js";
import type { RepositoryStorageError } from "../repositoryStorageError.js";
import { repositorySqlLayer } from "../sqlite/repositorySql.js";
import { openSqliteChangeCandidateCapturePersistence } from "../sqlite/sqliteChangeCandidateCapturePersistence.js";
import { openSqliteChangePersistence } from "../sqlite/sqliteChangePersistence.js";
import { openSqliteChangeValidationPersistence } from "../sqlite/sqliteChangeValidationPersistence.js";
import { openSqliteTaskPersistence } from "../sqlite/sqliteTaskPersistence.js";
import { openEffectCandidatePublication } from "../publication/publishCandidate.js";
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

  const programFor = (
    capturePersistence: ChangeCandidateCapturePersistence,
    validationPersistence: ChangeValidationPersistence,
    changePersistence: import("../change/changePersistence.js").ChangePersistence,
    taskPersistence: import("../task/taskPersistence.js").TaskPersistence,
  ) => {
    const reconciliation = openChangeReconciliation({
      persistence: changePersistence,
      github: localGitHubPullRequestGateway({ cwd: context.root }),
      cleanup: cleanupChangeResources,
    });
    return openChangeSubmit({
      repositoryCommonDirectory: context.commonDirectory,
      persistence: changePersistence,
      taskPersistence,
      reconciliation,
      resolvePolicy: (taskBacked) =>
        resolveCandidateValidationPolicy({
          context,
          globalConfigPath: input.globalConfigPath,
          taskBacked,
        }),
      publicationFor: (cwd) =>
        openEffectCandidatePublication({
          changePersistence,
          validationPersistence,
          git: localCandidatePublicationGit({ cwd }),
          github: localGitHubPullRequestGateway({ cwd }),
        }),
      detectTarget: detectGitHubPrTarget,
      captureCandidate: openChangeCandidateCapture({
        persistence: capturePersistence,
        git: localChangeCandidateCaptureGit,
      }).capture,
    });
  };
  const layerFor = (persistence: ChangeValidationPersistence) =>
    localCandidateValidationLayer({
      localRepositoryMainCheckoutRoot: context.root,
      artifactsRoot: context.paths.artifactsPath,
      persistence,
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
        Effect.all({
          capture: openSqliteChangeCandidateCapturePersistence(),
          validation: openSqliteChangeValidationPersistence(),
          change: openSqliteChangePersistence(),
          task: openSqliteTaskPersistence(context.taskPrefix),
        }).pipe(
          Effect.flatMap(({ capture, validation, change, task }) =>
            programFor(capture, validation, change, task)
              .submit(submitInput)
              .pipe(Effect.provide(layerFor(validation))),
          ),
          Effect.provide(repositoryLayer),
        ),
    },
  };
};
