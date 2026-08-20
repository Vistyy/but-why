import { NodeFileSystem } from "@effect/platform-node";
import { type Effect, Layer } from "effect";
import { piReviewerProcessExecutor } from "../../../agent/adapters/piReviewerProcessExecutor.js";
import type { AgentSessionPersistence } from "../../../agent/agentSession/agentSession.js";
import {
  piReviewerAgentRuntime,
  type ReviewerAgentRuntime,
} from "../../../agent/reviewerAgentRuntime.js";
import type { ReviewerOutput } from "../../../agent/reviewerOutput.js";
import type { RepositoryStorageError } from "../../../contracts/repositoryStorageError.js";
import { restoreDisposableWorkspace } from "../../../disposableWorkspace/adapters/disposableWorkspaceGit.js";
import { runDisposableExactCommitWorkspace } from "../../../disposableWorkspace/adapters/runDisposableExactCommitWorkspace.js";
import type { ChangeAgentSessionPort } from "../../changePorts.js";
import type { CandidateValidationExecutionPort } from "../../validation/changeValidationPorts.js";
import { makeCreateSnapshotWorkspace } from "../../validation/createSnapshotWorkspace.js";
import {
  CandidateReviewerExecution,
  type CandidateValidation,
  CandidateValidationExecution,
  CandidateValidationLive,
  CandidateValidationPaths,
  CandidateValidationWorkspace,
} from "../validateCandidate.js";

export const candidateValidationLayer = (input: {
  readonly localRepositoryRoot: string;
  readonly localRepositoryCommonDirectory: string;
  readonly artifactsRoot: string;
  readonly persistence: CandidateValidationExecutionPort;
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime<ReviewerOutput>;
  readonly agentSessionsRoot: string;
  readonly agentPersistence: AgentSessionPersistence;
  readonly getAgentSession: (
    changeId: string,
    producer: string,
  ) => Effect.Effect<number | undefined, RepositoryStorageError>;
  readonly linkAgentInvocation: ChangeAgentSessionPort["linkAgentInvocation"];
}): Layer.Layer<CandidateValidation, never, never> =>
  CandidateValidationLive.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        NodeFileSystem.layer,
        Layer.succeed(CandidateValidationPaths, {
          localRepositoryRoot: input.localRepositoryRoot,
          localRepositoryCommonDirectory: input.localRepositoryCommonDirectory,
          artifactsRoot: input.artifactsRoot,
          agentSessionsRoot: input.agentSessionsRoot,
          restoreWorkspace: restoreDisposableWorkspace,
          agentPersistence: input.agentPersistence,
          getAgentSession: input.getAgentSession,
          linkAgentInvocation: input.linkAgentInvocation,
        }),
        Layer.succeed(CandidateValidationExecution, input.persistence),
        Layer.succeed(
          CandidateValidationWorkspace,
          makeCreateSnapshotWorkspace(runDisposableExactCommitWorkspace),
        ),
        Layer.succeed(CandidateReviewerExecution, {
          runtime: input.reviewerAgentRuntime ?? piReviewerAgentRuntime,
          processExecutor: piReviewerProcessExecutor,
        }),
      ),
    ),
  );
