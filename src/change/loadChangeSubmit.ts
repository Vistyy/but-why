import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import { Effect } from "effect";

import type { ReviewerAgentRuntime } from "../agent/reviewerAgentRuntime.js";
import { resolveCandidateValidationPolicy } from "./candidateValidation/resolveCandidateValidationPolicy.js";
import { openCandidateCapture } from "./candidateCapture/captureLocalCandidate.js";
import type { CandidateCapturePersistence } from "./candidateCapture/candidateCapturePersistence.js";
import type { ChangeValidationPersistence } from "./validation/changeValidationPersistence.js";
import {
  localCandidateCaptureGit,
  readRepositoryBranchHead,
} from "./candidateCapture/localGitCandidate.js";
import { cleanupChangeResourcesWithRemote } from "./localChangeCleanupGit.js";
import { openChangeReconciliation } from "./reconcileChange.js";
import {
  reviewerSessionsChangeRoot,
  reviewerSessionsProducerRoot,
} from "./reviewerSession/reviewerSession.js";
import {
  openChangeSubmit,
  type ChangeSubmit,
  type ChangeSubmitResult,
  type ManagedRepoConfigResolution,
} from "./submitChange.js";
import {
  loadRepoLocalSubmissionContext,
  type LoadRepoLocalContextError,
} from "../init/repoContext.js";
import { decodeRepoConfigSource, readRepoConfig } from "../init/repoConfig.js";
import { candidateValidationLayer } from "./candidateValidation/candidateValidationLayer.js";
import { localCandidatePublicationGit } from "./publication/localCandidatePublicationGit.js";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import { repositorySqlLayer } from "../sqlite/repositorySql.js";
import { openSqliteCandidateCapturePersistence } from "../sqlite/sqliteCandidateCapturePersistence.js";
import { openSqliteChangePersistence } from "../sqlite/sqliteChangePersistence.js";
import { openSqliteChangeValidationPersistence } from "../sqlite/sqliteChangeValidationPersistence.js";
import { openCandidatePublication } from "./publication/candidatePublication.js";
import { detectGitHubPrTarget } from "../submissionEnvironment/githubTarget.js";
import { refreshRemoteChangeBase } from "../submissionEnvironment/remoteChangeBase.js";
import {
  githubChangeCleanupRemote,
  localGitHubPullRequestGateway,
} from "../submissionEnvironment/localGitHubPullRequestGateway.js";
import { openSqliteExecutionLock } from "../sqlite/sqliteExecutionLock.js";
import { readRepositoryFileAtCommit } from "../submissionEnvironment/repositoryFile.js";

export type LoadChangeSubmitResult =
  | { readonly ok: true; readonly submit: ChangeSubmit }
  | {
      readonly ok: false;
      readonly error: LoadRepoLocalContextError | { readonly code: "state_store_unavailable" };
    };

export const loadChangeSubmit = (input: {
  readonly cwd: string;
  readonly globalConfigPath: string;
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime;
}): LoadChangeSubmitResult => {
  const repoContext = loadRepoLocalSubmissionContext(input.cwd);
  if (!repoContext.ok) return repoContext;
  const context = repoContext.context;
  if (!existsSync(context.paths.statePath)) {
    return {
      ok: false,
      error: { code: "state_store_unavailable" },
    };
  }

  const programFor = (
    capturePersistence: CandidateCapturePersistence,
    validationPersistence: ChangeValidationPersistence,
    changePersistence: import("./changePersistence.js").ChangePersistence,
  ) => {
    const github = localGitHubPullRequestGateway({ cwd: context.root });
    const reconciliation = openChangeReconciliation({
      persistence: changePersistence,
      github,
      cleanup: cleanupChangeResourcesWithRemote(githubChangeCleanupRemote(github)),
      reviewerSessionPathFor: (changeId) =>
        reviewerSessionsChangeRoot(context.paths.operationalDir, changeId),
    });
    return openChangeSubmit({
      loadRepoConfig: (worktreePath): ManagedRepoConfigResolution => {
        const managedConfig = readRepoConfig(join(worktreePath, ".but-why", "config.json"));
        return managedConfig.ok
          ? managedConfig
          : {
              ok: false,
              message: `Candidate Repo Config is invalid: ${managedConfig.error.message}`,
              ...(managedConfig.error.path === undefined ? {} : { path: managedConfig.error.path }),
              ...(managedConfig.error.diagnostics === undefined
                ? {}
                : { diagnostics: managedConfig.error.diagnostics }),
            };
      },
      loadRepoConfigAtCommit: (worktreePath, commit): ManagedRepoConfigResolution => {
        const source = readRepositoryFileAtCommit(worktreePath, commit, ".but-why/config.json");
        if (!source.ok) {
          return {
            ok: false,
            message: `Change Base Repo Config could not be read at commit ${commit}.`,
          };
        }
        const decoded = decodeRepoConfigSource(source.content, ".but-why/config.json");
        return decoded.ok
          ? decoded
          : {
              ok: false,
              message: `Change Base Repo Config is invalid: ${decoded.error.message}`,
              ...(decoded.error.path === undefined ? {} : { path: decoded.error.path }),
              ...(decoded.error.diagnostics === undefined
                ? {}
                : { diagnostics: decoded.error.diagnostics }),
            };
      },
      repositoryCommonDirectory: context.commonDirectory,
      repositoryPath: context.root,
      persistence: changePersistence,
      reconciliation,
      resolvePolicy: (acceptanceContextSupplied, repoConfig, worktreePath, validationRepoConfig) =>
        resolveCandidateValidationPolicy({
          context,
          globalConfigPath: input.globalConfigPath,
          acceptanceContextSupplied,
          repoConfig,
          ...(validationRepoConfig === undefined ? {} : { validationRepoConfig }),
          repoRoot: worktreePath,
        }),
      publicationFor: (cwd) =>
        openCandidatePublication({
          changePersistence,
          validationPersistence,
          git: localCandidatePublicationGit({ cwd }),
          github: localGitHubPullRequestGateway({ cwd }),
        }),
      refreshBase: refreshRemoteChangeBase,
      readBranchHead: (cwd, expectedBranchRef) =>
        Effect.sync(() => readRepositoryBranchHead(cwd, expectedBranchRef)),
      detectTarget: (cwd, branch, baseRef, baseRemoteUrl) =>
        detectGitHubPrTarget(cwd, branch, undefined, undefined, baseRef, baseRemoteUrl),
      captureCandidate: openCandidateCapture({
        persistence: capturePersistence,
        git: localCandidateCaptureGit,
      }).capture,
      executionLock: openSqliteExecutionLock({ commonDirectory: context.commonDirectory }),
    });
  };
  const layerFor = (
    persistence: ChangeValidationPersistence,
    changePersistence: import("./changePersistence.js").ChangePersistence,
  ) =>
    candidateValidationLayer({
      localRepositoryMainCheckoutRoot: context.mainCheckoutRoot,
      artifactsRoot: context.paths.artifactsPath,
      persistence,
      ...(input.reviewerAgentRuntime === undefined
        ? {}
        : { reviewerAgentRuntime: input.reviewerAgentRuntime }),
      sessionStore: {
        get: changePersistence.getReviewerSession,
        save: changePersistence.saveReviewerSession,
        remove: (changeId: string, producer: string) =>
          changePersistence.removeReviewerSession(changeId, producer).pipe(
            Effect.tap(() =>
              Effect.sync(() =>
                rmSync(
                  reviewerSessionsProducerRoot(context.paths.operationalDir, changeId, producer),
                  {
                    recursive: true,
                    force: true,
                  },
                ),
              ),
            ),
          ),
      },
      reviewerSessionsRoot: context.paths.operationalDir,
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
        }).pipe(
          Effect.flatMap(({ capture, validation, change }) =>
            programFor(capture, validation, change)
              .submit(submitInput)
              .pipe(Effect.provide(layerFor(validation, change))),
          ),
          Effect.provide(repositoryLayer),
        ),
    },
  };
};
