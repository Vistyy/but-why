import { Effect, Layer } from "effect";

import { piReviewerProcessExecutor } from "../../src/agent/adapters/piReviewerProcessExecutor.js";
import {
  piReviewerAgentRuntime,
  type ReviewerAgentRuntime,
} from "../../src/agent/reviewerAgentRuntime.js";
import type { ReviewerOutput } from "../../src/agent/reviewerOutput.js";
import {
  CandidateReviewerExecution,
  CandidateValidationExecution,
  CandidateValidationLive,
  CandidateValidationPaths,
  CandidateValidationWorkspace,
} from "../../src/change/candidateValidation/validateCandidate.js";
import { makeCreateSnapshotWorkspace } from "../../src/change/validation/createSnapshotWorkspace.js";
import { runDisposableExactCommitWorkspace } from "../../src/disposableWorkspace/adapters/runDisposableExactCommitWorkspace.js";
import { type RepositorySqlConfig, repositorySqlLayer } from "../../src/sqlite/repositorySql.js";
import { openSqliteAgentSessionPersistence } from "../../src/sqlite/sqliteAgentSessionPersistence.js";
import { openSqliteChangeAgentSessionPort } from "../../src/sqlite/sqliteChangeAgentSessionPersistence.js";
import {
  type ChangeValidationTestDependencies,
  openSqliteChangeValidationTestDependencies,
} from "../support/changeValidationPorts.js";

export const candidateValidationForTest = (input: {
  readonly localRepositoryRoot: string;
  readonly artifactsRoot: string;
  readonly repository: RepositorySqlConfig;
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime<ReviewerOutput>;
}) => {
  const repositoryLayer = repositorySqlLayer(input.repository);
  const persistenceLayer = Layer.effect(
    CandidateValidationExecution,
    Effect.map(
      openSqliteChangeValidationTestDependencies(),
      (dependencies) => dependencies.execution,
    ),
  ).pipe(Layer.provide(repositoryLayer));
  const sessionLayer = Layer.effect(
    CandidateValidationPaths,
    Effect.gen(function* () {
      const agentSessions = yield* openSqliteChangeAgentSessionPort();
      const agentPersistence = yield* openSqliteAgentSessionPersistence();
      return {
        localRepositoryRoot: input.localRepositoryRoot,
        localRepositoryCommonDirectory: input.repository.commonDirectory,
        artifactsRoot: input.artifactsRoot,
        agentSessionsRoot: input.artifactsRoot,
        agentPersistence,
        getAgentSession: agentSessions.getAgentSession,
        linkAgentInvocation: agentSessions.linkAgentInvocation,
      };
    }),
  ).pipe(Layer.provide(repositoryLayer));
  const layer = CandidateValidationLive.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        sessionLayer,
        persistenceLayer,
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
  const withPersistence = <A>(
    use: (persistence: ChangeValidationTestDependencies) => Effect.Effect<A, unknown>,
  ) =>
    Effect.flatMap(openSqliteChangeValidationTestDependencies(), use).pipe(
      Effect.provide(repositoryLayer),
    );

  return {
    layer,
    getRun: (validationRunId: number) =>
      withPersistence((persistence) => persistence.reads.getRunById(validationRunId)),
    listPhaseResults: (validationRunId: number) =>
      withPersistence((persistence) =>
        Effect.map(persistence.reads.listPhaseResults(validationRunId), (results) =>
          results.map(({ producer, outcome }) => ({ producer, outcome })),
        ),
      ),
    listFindings: (validationRunId: number) =>
      withPersistence((persistence) => persistence.reads.listFindings(validationRunId)),
    listArtifacts: (validationRunId: number) =>
      withPersistence((persistence) => persistence.reads.listArtifacts(validationRunId)),
    listToolingFailures: (validationRunId: number) =>
      withPersistence((persistence) => persistence.reads.listToolingFailures(validationRunId)),
    runWithPersistence: withPersistence,
  };
};
