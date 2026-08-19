import { Effect } from "effect";

import type { AgentSessionPersistence } from "../../agent/agentSession/agentSession.js";
import type { ReviewerAgentRuntime } from "../../agent/reviewerAgentRuntime.js";
import type { ReviewerOutput } from "../../agent/reviewerOutput.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import { openSqliteExecutionLock } from "../../repositoryRuntime/adapters/sqlite/sqliteExecutionLock.js";
import type { ResolveLocalRepositoryError } from "../../repositoryRuntime/repositoryContext.js";
import { openSubmissionRepositoryRuntime } from "../../repositoryRuntime/repositoryRuntime.js";
import { openSqliteAgentSessionPersistence } from "../../sqlite/sqliteAgentSessionPersistence.js";
import { openSqliteCandidateCapturePersistence } from "../../sqlite/sqliteCandidateCapturePersistence.js";
import { openSqliteCandidatePublicationPort } from "../../sqlite/sqliteCandidatePublicationPersistence.js";
import { openSqliteCandidateValidationExecutionPort } from "../../sqlite/sqliteCandidateValidationExecutionPersistence.js";
import { openSqliteChangeAgentSessionPort } from "../../sqlite/sqliteChangeAgentSessionPersistence.js";
import { openSqliteChangeSubmissionPort } from "../../sqlite/sqliteChangeSubmissionPersistence.js";
import { detectGitHubPrTarget } from "../../submissionEnvironment/adapters/githubTarget.js";
import { localGitHubPullRequestGateway } from "../../submissionEnvironment/adapters/localGitHubPullRequestGateway.js";
import { refreshRemoteChangeBase } from "../../submissionEnvironment/adapters/remoteChangeBase.js";
import { openSqliteTaskChangeSubmissionCompletion } from "../../taskChange/adapters/sqlite/sqliteTaskChangeCompletionPersistence.js";
import {
  localCandidateCaptureGit,
  readRepositoryBranchHead,
} from "../candidateCapture/adapters/localGitCandidate.js";
import type { CandidateCapturePersistence } from "../candidateCapture/candidateCapturePersistence.js";
import { openCandidateCapture } from "../candidateCapture/captureLocalCandidate.js";
import { candidateValidationLayer } from "../candidateValidation/composition/candidateValidationLayer.js";
import type {
  CandidatePublicationPort,
  ChangeAgentSessionPort,
  ChangeSubmissionPort,
} from "../changePorts.js";
import { localCandidatePublicationGit } from "../publication/adapters/localCandidatePublicationGit.js";
import { openCandidatePublication } from "../publication/candidatePublication.js";
import { type ChangeSubmit, type ChangeSubmitResult, openChangeSubmit } from "../submitChange.js";
import type { CandidateValidationExecutionPort } from "../validation/changeValidationPorts.js";

export type LoadChangeSubmitResult =
  | { readonly ok: true; readonly submit: ChangeSubmit }
  | {
      readonly ok: false;
      readonly error: ResolveLocalRepositoryError | { readonly code: "state_store_unavailable" };
    };

export const loadChangeSubmit = (input: {
  readonly cwd: string;
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime<ReviewerOutput>;
}): LoadChangeSubmitResult => {
  const loaded = openSubmissionRepositoryRuntime(input.cwd);
  if (!loaded.ok) return loaded;
  const { context } = loaded.runtime;

  const programFor = (
    capturePersistence: CandidateCapturePersistence,
    submissionOwner: ChangeSubmissionPort,
    submissionCompletion: ChangeSubmissionPort["completeMergedChange"],
    publication: CandidatePublicationPort,
  ) => {
    const submission: ChangeSubmissionPort = {
      getChangeById: submissionOwner.getChangeById,
      getChangeForOutputById: submissionOwner.getChangeForOutputById,
      getCompletedPublicationEvidence: submissionOwner.getCompletedPublicationEvidence,
      completeMergedChange: submissionCompletion,
    };
    const github = localGitHubPullRequestGateway({ cwd: context.root });
    return openChangeSubmit({
      github,
      repositoryPath: context.root,
      persistence: submission,
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
    agentSessions: ChangeAgentSessionPort,
    agentPersistence: AgentSessionPersistence,
  ) =>
    candidateValidationLayer({
      localRepositoryRoot: context.root,
      localRepositoryCommonDirectory: context.commonDirectory,
      artifactsRoot: context.paths.artifactsPath,
      persistence,
      ...(input.reviewerAgentRuntime === undefined
        ? {}
        : { reviewerAgentRuntime: input.reviewerAgentRuntime }),
      agentSessionsRoot: context.paths.agentSessionsPath,
      agentPersistence,
      getAgentSession: agentSessions.getAgentSession,
      linkAgentInvocation: agentSessions.linkAgentInvocation,
    });

  return {
    ok: true,
    submit: {
      submit: (submitInput): Effect.Effect<ChangeSubmitResult, RepositoryStorageError> =>
        Effect.all({
          capture: openSqliteCandidateCapturePersistence(),
          validation: openSqliteCandidateValidationExecutionPort(),
          submissionOwner: openSqliteChangeSubmissionPort(),
          submissionCompletion: openSqliteTaskChangeSubmissionCompletion(),
          agentSessions: openSqliteChangeAgentSessionPort(),
          agentPersistence: openSqliteAgentSessionPersistence(),
          publication: openSqliteCandidatePublicationPort(),
        }).pipe(
          Effect.flatMap(
            ({
              capture,
              validation,
              submissionOwner,
              submissionCompletion,
              agentSessions,
              agentPersistence,
              publication,
            }) =>
              programFor(capture, submissionOwner, submissionCompletion, publication)
                .submit(submitInput)
                .pipe(Effect.provide(layerFor(validation, agentSessions, agentPersistence))),
          ),
          loaded.runtime.provide,
        ),
    },
  };
};
