import { Effect, Layer } from "effect";

import { piReviewerProcessExecutor } from "../../src/agent/piReviewerProcessExecutor.js";
import {
  piReviewerAgentRuntime,
  type ReviewerAgentRuntime,
} from "../../src/agent/reviewerAgentRuntime.js";
import {
  CandidateReviewerExecution,
  CandidateValidationExecution,
  CandidateValidationLive,
  CandidateValidationPaths,
} from "../../src/change/candidateValidation/validateCandidate.js";
import type { ReviewerSessionStore } from "../../src/change/reviewerSession/reviewerSession.js";
import type { ReviewerOutput } from "../../src/contracts/reviewerOutput.js";
import { type RepositorySqlConfig, repositorySqlLayer } from "../../src/sqlite/repositorySql.js";
import {
  type ChangeValidationTestDependencies,
  openSqliteChangeValidationTestDependencies,
} from "../support/changeValidationPorts.js";

export const candidateValidationForTest = (input: {
  readonly localRepositoryMainCheckoutRoot: string;
  readonly artifactsRoot: string;
  readonly repository: RepositorySqlConfig;
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime<ReviewerOutput>;
  readonly reviewerSessionsRoot?: string;
  readonly sessionStore?: ReviewerSessionStore;
}) => {
  const repositoryLayer = repositorySqlLayer(input.repository);
  const persistenceLayer = Layer.effect(
    CandidateValidationExecution,
    Effect.map(
      openSqliteChangeValidationTestDependencies(),
      (dependencies) => dependencies.execution,
    ),
  ).pipe(Layer.provide(repositoryLayer));
  const layer = CandidateValidationLive.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(CandidateValidationPaths, {
          localRepositoryMainCheckoutRoot: input.localRepositoryMainCheckoutRoot,
          artifactsRoot: input.artifactsRoot,
          ...(input.reviewerSessionsRoot === undefined
            ? {}
            : { reviewerSessionsRoot: input.reviewerSessionsRoot }),
          ...(input.sessionStore === undefined ? {} : { sessionStore: input.sessionStore }),
        }),
        persistenceLayer,
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
