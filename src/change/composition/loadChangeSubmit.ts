import { join } from "node:path";

import { Effect } from "effect";

import type { ReviewerAgentRuntime } from "../../agent/reviewerAgentRuntime.js";
import type { ReviewerOutput } from "../../agent/reviewerOutput.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import { readGlobalConfig } from "../../init/adapters/globalConfig.js";
import { decodeRepoConfigSource, readRepoConfig } from "../../init/adapters/repoConfig.js";
import type { ResolveLocalRepositoryError } from "../../repositoryRuntime/repositoryContext.js";
import { openSubmissionRepositoryRuntime } from "../../repositoryRuntime/repositoryRuntime.js";
import { openSqliteCandidateCapturePersistence } from "../../sqlite/sqliteCandidateCapturePersistence.js";
import { openSqliteCandidatePublicationPort } from "../../sqlite/sqliteCandidatePublicationPersistence.js";
import { openSqliteCandidateValidationExecutionPort } from "../../sqlite/sqliteCandidateValidationExecutionPersistence.js";
import { openSqliteChangeReviewerSessionPort } from "../../sqlite/sqliteChangeReviewerSessionPersistence.js";
import { openSqliteChangeSubmissionPort } from "../../sqlite/sqliteChangeSubmissionPersistence.js";
import { openSqliteExecutionLock } from "../../sqlite/sqliteExecutionLock.js";
import { detectGitHubPrTarget } from "../../submissionEnvironment/adapters/githubTarget.js";
import { localGitHubPullRequestGateway } from "../../submissionEnvironment/adapters/localGitHubPullRequestGateway.js";
import { refreshRemoteChangeBase } from "../../submissionEnvironment/adapters/remoteChangeBase.js";
import { readRepositoryFileAtCommit } from "../../submissionEnvironment/adapters/repositoryFile.js";
import {
  localCandidateCaptureGit,
  readRepositoryBranchHead,
} from "../candidateCapture/adapters/localGitCandidate.js";
import type { CandidateCapturePersistence } from "../candidateCapture/candidateCapturePersistence.js";
import { openCandidateCapture } from "../candidateCapture/captureLocalCandidate.js";
import { candidateValidationLayer } from "../candidateValidation/composition/candidateValidationLayer.js";
import { resolveCandidateValidationPolicy } from "../candidateValidation/resolveCandidateValidationPolicy.js";
import type {
  CandidatePublicationPort,
  ChangeReviewerSessionPort,
  ChangeSubmissionPort,
} from "../changePorts.js";
import { localCandidatePublicationGit } from "../publication/adapters/localCandidatePublicationGit.js";
import { openCandidatePublication } from "../publication/candidatePublication.js";
import {
  type ChangeSubmit,
  type ChangeSubmitResult,
  type ManagedRepoConfigResolution,
  openChangeSubmit,
} from "../submitChange.js";
import type { CandidateValidationExecutionPort } from "../validation/changeValidationPorts.js";

export type LoadChangeSubmitResult =
  | { readonly ok: true; readonly submit: ChangeSubmit }
  | {
      readonly ok: false;
      readonly error: ResolveLocalRepositoryError | { readonly code: "state_store_unavailable" };
    };

export const loadChangeSubmit = (input: {
  readonly cwd: string;
  readonly globalConfigPath: string;
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime<ReviewerOutput>;
}): LoadChangeSubmitResult => {
  const loaded = openSubmissionRepositoryRuntime(input.cwd);
  if (!loaded.ok) return loaded;
  const { context } = loaded.runtime;

  const programFor = (
    capturePersistence: CandidateCapturePersistence,
    submission: ChangeSubmissionPort,
    publication: CandidatePublicationPort,
  ) => {
    const github = localGitHubPullRequestGateway({ cwd: context.root });
    return openChangeSubmit({
      github,
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
      persistence: submission,
      resolvePolicy: (
        acceptanceContextSupplied,
        repoConfig,
        worktreePath,
        validationRepoConfig,
      ) => {
        const globalConfig = readGlobalConfig(input.globalConfigPath);
        return globalConfig.ok
          ? resolveCandidateValidationPolicy({
              context,
              globalConfigPath: input.globalConfigPath,
              globalConfig: globalConfig.config,
              acceptanceContextSupplied,
              repoConfig,
              ...(validationRepoConfig === undefined ? {} : { validationRepoConfig }),
              repoRoot: worktreePath,
            })
          : globalConfig;
      },
      publicationFor: (cwd) =>
        openCandidatePublication({
          changePersistence: publication,
          git: localCandidatePublicationGit({ cwd }),
          github: localGitHubPullRequestGateway({ cwd }),
        }),
      refreshBase: refreshRemoteChangeBase,
      readBranchHead: (cwd, expectedBranchRef) =>
        Effect.sync(() => readRepositoryBranchHead(cwd, expectedBranchRef)),
      detectTarget: (cwd, _branch, baseRef, baseRemoteUrl) =>
        detectGitHubPrTarget(cwd, baseRef, undefined, baseRemoteUrl),
      captureCandidate: openCandidateCapture({
        persistence: capturePersistence,
        git: localCandidateCaptureGit,
      }).capture,
      executionLock: openSqliteExecutionLock({ commonDirectory: context.commonDirectory }),
    });
  };
  const layerFor = (
    persistence: CandidateValidationExecutionPort,
    reviewerSessions: ChangeReviewerSessionPort,
  ) =>
    candidateValidationLayer({
      localRepositoryMainCheckoutRoot: context.mainCheckoutRoot,
      artifactsRoot: context.paths.artifactsPath,
      persistence,
      ...(input.reviewerAgentRuntime === undefined
        ? {}
        : { reviewerAgentRuntime: input.reviewerAgentRuntime }),
      sessionStore: {
        get: reviewerSessions.getReviewerSession,
        save: reviewerSessions.saveReviewerSession,
        remove: (changeId: string, producer: string) =>
          reviewerSessions.removeReviewerSession(changeId, producer),
      },
      reviewerSessionsRoot: context.paths.operationalDir,
    });

  return {
    ok: true,
    submit: {
      submit: (submitInput): Effect.Effect<ChangeSubmitResult, RepositoryStorageError> =>
        Effect.all({
          capture: openSqliteCandidateCapturePersistence(),
          validation: openSqliteCandidateValidationExecutionPort(),
          submission: openSqliteChangeSubmissionPort(),
          reviewerSessions: openSqliteChangeReviewerSessionPort(),
          publication: openSqliteCandidatePublicationPort(),
        }).pipe(
          Effect.flatMap(({ capture, validation, submission, reviewerSessions, publication }) =>
            programFor(capture, submission, publication)
              .submit(submitInput)
              .pipe(Effect.provide(layerFor(validation, reviewerSessions))),
          ),
          loaded.runtime.provide,
        ),
    },
  };
};
