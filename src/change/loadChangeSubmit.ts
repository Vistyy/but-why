import { existsSync } from "node:fs";

import { Effect } from "effect";

import type { ReviewerAgentRuntime } from "../agent/reviewerAgentRuntime.js";
import { resolveCandidateValidationPolicy } from "./candidateValidation/resolveCandidateValidationPolicy.js";
import { openCandidateCapture } from "./candidateCapture/captureLocalCandidate.js";
import type { CandidateCapturePersistence } from "./candidateCapture/candidateCapturePersistence.js";
import type { ChangeValidationPersistence } from "./validation/changeValidationPersistence.js";
import { localCandidateCaptureGit } from "./candidateCapture/localGitCandidate.js";
import { cleanupChangeResources } from "./localChangeCleanupGit.js";
import { openChangeReconciliation } from "./reconcileChange.js";
import { openChangeSubmit, type ChangeSubmit, type ChangeSubmitResult } from "./submitChange.js";
import { loadRepoLocalContext, type LoadRepoLocalContextError } from "../init/repoContext.js";
import { candidateValidationLayer } from "./candidateValidation/candidateValidationLayer.js";
import { localCandidatePublicationGit } from "./publication/localCandidatePublicationGit.js";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import { repositorySqlLayer } from "../sqlite/repositorySql.js";
import { openSqliteCandidateCapturePersistence } from "../sqlite/sqliteCandidateCapturePersistence.js";
import { openSqliteChangePersistence } from "../sqlite/sqliteChangePersistence.js";
import { openSqliteChangeValidationPersistence } from "../sqlite/sqliteChangeValidationPersistence.js";
import { openSqliteTaskPersistence } from "../sqlite/sqliteTaskPersistence.js";
import { openCandidatePublication } from "./publication/candidatePublication.js";
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
    capturePersistence: CandidateCapturePersistence,
    validationPersistence: ChangeValidationPersistence,
    changePersistence: import("./changePersistence.js").ChangePersistence,
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
        openCandidatePublication({
          changePersistence,
          validationPersistence,
          git: localCandidatePublicationGit({ cwd }),
          github: localGitHubPullRequestGateway({ cwd }),
        }),
      detectTarget: detectGitHubPrTarget,
      captureCandidate: openCandidateCapture({
        persistence: capturePersistence,
        git: localCandidateCaptureGit,
      }).capture,
    });
  };
  const layerFor = (persistence: ChangeValidationPersistence) =>
    candidateValidationLayer({
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
          capture: openSqliteCandidateCapturePersistence(),
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
