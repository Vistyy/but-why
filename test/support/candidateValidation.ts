import { Effect, Layer } from "effect";

import {
  piReviewerAgentRuntime,
  type ReviewerAgentRuntime,
} from "../../src/agent/reviewerAgentRuntime.js";
import {
  CandidateReviewerAgentRuntime,
  CandidateValidationLive,
  CandidateValidationPaths,
  CandidateValidationPersistence,
} from "../../src/change/candidateValidation/validateCandidate.js";
import type { ReviewerSessionStore } from "../../src/change/reviewerSession/reviewerSession.js";
import type { ChangeValidationPersistence } from "../../src/change/validation/changeValidationPersistence.js";
import { type RepositorySqlConfig, repositorySqlLayer } from "../../src/sqlite/repositorySql.js";
import { openSqliteChangeValidationPersistence } from "../../src/sqlite/sqliteChangeValidationPersistence.js";

export const candidateValidationForTest = (input: {
  readonly localRepositoryMainCheckoutRoot: string;
  readonly artifactsRoot: string;
  readonly repository: RepositorySqlConfig;
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime;
  readonly reviewerSessionsRoot?: string;
  readonly sessionStore?: ReviewerSessionStore;
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
          ...(input.reviewerSessionsRoot === undefined
            ? {}
            : { reviewerSessionsRoot: input.reviewerSessionsRoot }),
          ...(input.sessionStore === undefined ? {} : { sessionStore: input.sessionStore }),
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
    getRun: (validationRunId: string) =>
      withPersistence((persistence) => persistence.getRunById(validationRunId)),
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
    runWithPersistence: withPersistence,
  };
};
