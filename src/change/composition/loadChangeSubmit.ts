import { Effect } from "effect";
import { openSqliteAgentSessionPersistence } from "../../agent/agentSession/adapters/sqlite/sqliteAgentSessionPersistence.js";
import type { AgentSessionPersistence } from "../../agent/agentSession/agentSession.js";
import type { ReviewerAgentRuntime } from "../../agent/reviewerAgentRuntime.js";
import type { ReviewerOutput } from "../../agent/reviewerOutput.js";
import { openSqliteExecutionLock } from "../../repositoryRuntime/adapters/sqlite/sqliteExecutionLock.js";
import type { ResolveLocalRepositoryError } from "../../repositoryRuntime/repositoryContext.js";
import { openSubmissionRepositoryRuntime } from "../../repositoryRuntime/repositoryRuntime.js";
import { detectGitHubPrTarget } from "../../submissionEnvironment/adapters/githubTarget.js";
import { localGitHubPullRequestGateway } from "../../submissionEnvironment/adapters/localGitHubPullRequestGateway.js";
import { refreshRemoteChangeBase } from "../../submissionEnvironment/adapters/remoteChangeBase.js";
import { openSqliteTaskChangeSubmissionCompletion } from "../../taskChange/adapters/sqlite/sqliteTaskChangeCompletionPersistence.js";
import { taskChangeCompletionOperations } from "../../taskChange/composition/loadTaskChangePersistence.js";
import { openSqliteCandidateCapturePersistence } from "../adapters/sqlite/sqliteCandidateCapturePersistence.js";
import { openSqliteCandidatePublicationPort } from "../adapters/sqlite/sqliteCandidatePublicationPersistence.js";
import { openSqliteCandidateValidationExecutionPort } from "../adapters/sqlite/sqliteCandidateValidationExecutionPersistence.js";
import { openSqliteChangeAgentSessionPort } from "../adapters/sqlite/sqliteChangeAgentSessionPersistence.js";
import { openSqliteChangeAuthorityPort } from "../adapters/sqlite/sqliteChangeAuthorityPersistence.js";
import { openSqliteChangeSubmissionPort } from "../adapters/sqlite/sqliteChangeSubmissionPersistence.js";
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
  ChangeAuthorityPort,
  ChangeSubmissionPort,
} from "../changePorts.js";
import { localCandidatePublicationGit } from "../publication/adapters/localCandidatePublicationGit.js";
import { openCandidatePublication } from "../publication/candidatePublication.js";
import { makePiAiStallDetector } from "../stallDetection/stallDetector.js";
import {
  type ChangeSubmit,
  type ChangeSubmitError,
  type ChangeSubmitResult,
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
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime<ReviewerOutput>;
}): LoadChangeSubmitResult => {
  const loaded = openSubmissionRepositoryRuntime(input.cwd);
  if (!loaded.ok) return loaded;
  const { context } = loaded.runtime;

  const programFor = (
    capturePersistence: CandidateCapturePersistence,
    authority: ChangeAuthorityPort,
    submissionOwner: Omit<ChangeSubmissionPort, "completeMergedChange">,
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
      authority,
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
      stallDetector: makePiAiStallDetector(),
    });

  return {
    ok: true,
    submit: {
      submit: (submitInput): Effect.Effect<ChangeSubmitResult, ChangeSubmitError> =>
        Effect.all({
          capture: openSqliteCandidateCapturePersistence(),
          validation: openSqliteCandidateValidationExecutionPort(),
          authority: openSqliteChangeAuthorityPort(),
          submissionOwner: openSqliteChangeSubmissionPort(),
          submissionCompletion: openSqliteTaskChangeSubmissionCompletion(
            taskChangeCompletionOperations,
          ),
          agentSessions: openSqliteChangeAgentSessionPort(),
          agentPersistence: openSqliteAgentSessionPersistence(),
          publication: openSqliteCandidatePublicationPort(),
        }).pipe(
          Effect.flatMap(
            ({
              capture,
              validation,
              authority,
              submissionOwner,
              submissionCompletion,
              agentSessions,
              agentPersistence,
              publication,
            }) =>
              programFor(capture, authority, submissionOwner, submissionCompletion, publication)
                .submit(submitInput)
                .pipe(Effect.provide(layerFor(validation, agentSessions, agentPersistence))),
          ),
          loaded.runtime.provide,
        ),
    },
  };
};
