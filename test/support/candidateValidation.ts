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
import { openSqliteChangeReviewerSessionPort } from "../../src/sqlite/sqliteChangeReviewerSessionPersistence.js";
import {
  type ChangeValidationTestDependencies,
  openSqliteChangeValidationTestDependencies,
} from "../support/changeValidationPorts.js";

export const candidateValidationForTest = (input: {
  readonly localRepositoryMainCheckoutRoot: string;
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
      const reviewerSessions = yield* openSqliteChangeReviewerSessionPort();
      const agentPersistence = yield* openSqliteAgentSessionPersistence();
      return {
        localRepositoryMainCheckoutRoot: input.localRepositoryMainCheckoutRoot,
        artifactsRoot: input.artifactsRoot,
        reviewerSessionsRoot: input.artifactsRoot,
        agentPersistence,
        getAgentSession: reviewerSessions.getAgentSession,
        linkAgentInvocation: reviewerSessions.linkAgentInvocation,
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
    getRun: (validationRunId: string) =>
      withPersistence((persistence) => persistence.reads.getRunById(validationRunId)),
    listRounds: (validationRunId: string) =>
      withPersistence((persistence) =>
        Effect.map(persistence.reads.listRounds(validationRunId), (rounds) =>
          rounds.map(({ producer, status }) => ({ producer, status })),
        ),
      ),
    listFindings: (validationRunId: string) =>
      withPersistence((persistence) => persistence.reads.listFindings(validationRunId)),
    listArtifacts: (validationRunId: string) =>
      withPersistence((persistence) => persistence.reads.listArtifacts(validationRunId)),
    listToolingFailures: (validationRunId: string) =>
      withPersistence((persistence) => persistence.reads.listToolingFailures(validationRunId)),
    runWithPersistence: withPersistence,
  };
};
