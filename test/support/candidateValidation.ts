import { Effect, Layer } from "effect";

import {
  piReviewerAgentRuntime,
  type ReviewerAgentRuntime,
} from "../../src/agent/reviewerAgentRuntime.js";
import type { ChangeValidationPersistence } from "../../src/changeValidation/changeValidationPersistence.js";
import {
  CandidateValidationLive,
  CandidateValidationPaths,
  CandidateValidationPersistence,
  CandidateReviewerAgentRuntime,
} from "../../src/candidateValidation/validateCandidate.js";
import { repositorySqlLayer, type RepositorySqlConfig } from "../../src/sqlite/repositorySql.js";
import { openSqliteChangeValidationPersistence } from "../../src/sqlite/sqliteChangeValidationPersistence.js";

export const candidateValidationForTest = (input: {
  readonly localRepositoryMainCheckoutRoot: string;
  readonly artifactsRoot: string;
  readonly repository: RepositorySqlConfig;
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime;
}) => {
  const repositoryLayer = repositorySqlLayer(input.repository);
  const persistenceLayer = Layer.effect(
    CandidateValidationPersistence,
    openSqliteChangeValidationPersistence(),
  ).pipe(Layer.provide(repositoryLayer));
  const layer = CandidateValidationLive.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(CandidateValidationPaths, {
          localRepositoryMainCheckoutRoot: input.localRepositoryMainCheckoutRoot,
          artifactsRoot: input.artifactsRoot,
        }),
        persistenceLayer,
        Layer.succeed(
          CandidateReviewerAgentRuntime,
          input.reviewerAgentRuntime ?? piReviewerAgentRuntime,
        ),
      ),
    ),
  );
  const withPersistence = <A>(
    use: (persistence: ChangeValidationPersistence) => Effect.Effect<A, unknown>,
  ) =>
    Effect.flatMap(openSqliteChangeValidationPersistence(), use).pipe(
      Effect.provide(repositoryLayer),
    );

  return {
    layer,
    listRounds: (validationRunId: string) =>
      withPersistence((persistence) =>
        Effect.map(persistence.listRounds(validationRunId), (rounds) =>
          rounds.map(({ producer, status }) => ({ producer, status })),
        ),
      ),
    listFindings: (validationRunId: string) =>
      withPersistence((persistence) => persistence.listFindings(validationRunId)),
    listArtifacts: (validationRunId: string) =>
      withPersistence((persistence) => persistence.listArtifacts(validationRunId)),
    listToolingFailures: (validationRunId: string) =>
      withPersistence((persistence) => persistence.listToolingFailures(validationRunId)),
  };
};
