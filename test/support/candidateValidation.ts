import { Effect, Layer } from "effect";

import {
  piReviewerAgentRuntime,
  type ReviewerAgentRuntime,
} from "../../src/agent/reviewerAgentRuntime.js";
import {
  CandidateValidationLive,
  CandidateValidationPaths,
  CandidateValidationPersistence,
  CandidateReviewerAgentRuntime,
} from "../../src/candidateValidation/validateCandidate.js";
import type { CandidateValidationRunStore as CandidateValidationRunStorePort } from "../../src/candidateValidation/candidateValidationRunStore.js";

export const candidateValidationForTest = (input: {
  readonly localRepositoryMainCheckoutRoot: string;
  readonly artifactsRoot: string;
  readonly runStore: CandidateValidationRunStorePort;
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime;
}) => {
  const persistence = effectPersistence(input.runStore);
  const layer = CandidateValidationLive.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(CandidateValidationPaths, {
          localRepositoryMainCheckoutRoot: input.localRepositoryMainCheckoutRoot,
          artifactsRoot: input.artifactsRoot,
        }),
        Layer.succeed(CandidateValidationPersistence, persistence),
        Layer.succeed(
          CandidateReviewerAgentRuntime,
          input.reviewerAgentRuntime ?? piReviewerAgentRuntime,
        ),
      ),
    ),
  );
  return {
    layer,
    listRounds: (validationRunId: string) =>
      input.runStore
        .listRounds(validationRunId)
        .map(({ producer, status }) => ({ producer, status })),
    listFindings: input.runStore.listFindings,
    listArtifacts: input.runStore.listArtifacts,
    listToolingFailures: input.runStore.listToolingFailures,
  };
};

const effectPersistence = (store: CandidateValidationRunStorePort) => ({
  getCandidateById: () => Effect.die("Candidate inspection is not available in this test"),
  listCandidatesForChange: () => Effect.die("Candidate inspection is not available in this test"),
  startOrReuse: (input: Parameters<typeof store.startOrReuse>[0]) =>
    Effect.sync(() => store.startOrReuse(input)),
  complete: (input: Parameters<typeof store.complete>[0]) =>
    Effect.sync(() => store.complete(input)),
  getRunById: (validationRunId: string) => Effect.sync(() => store.getRunById(validationRunId)),
  listRunsForCandidate: (candidateId: string) =>
    Effect.sync(() => store.listRunsForCandidate(candidateId)),
  recordWorkspaceSetup: (input: Parameters<typeof store.recordWorkspaceSetup>[0]) =>
    Effect.sync(() => store.recordWorkspaceSetup(input)),
  recordToolingFailure: (input: Parameters<typeof store.recordToolingFailure>[0]) =>
    Effect.sync(() => store.recordToolingFailure(input)),
  recordPrepareRound: (input: Parameters<typeof store.recordPrepareRound>[0]) =>
    Effect.sync(() => store.recordPrepareRound(input)),
  recordCheckRound: (input: Parameters<typeof store.recordCheckRound>[0]) =>
    Effect.sync(() => store.recordCheckRound(input)),
  recordAcceptanceRound: (input: Parameters<typeof store.recordAcceptanceRound>[0]) =>
    Effect.sync(() => store.recordAcceptanceRound(input)),
  recordSpecialistRound: (input: Parameters<typeof store.recordSpecialistRound>[0]) =>
    Effect.sync(() => store.recordSpecialistRound(input)),
  listRounds: (validationRunId: string) => Effect.sync(() => store.listRounds(validationRunId)),
  listFindings: (validationRunId: string) => Effect.sync(() => store.listFindings(validationRunId)),
  listPreviousCandidateReviewerFindings: (
    input: Parameters<typeof store.listPreviousCandidateReviewerFindings>[0],
  ) => Effect.sync(() => store.listPreviousCandidateReviewerFindings(input)),
  listToolingFailures: (validationRunId: string) =>
    Effect.sync(() => store.listToolingFailures(validationRunId)),
  listArtifacts: (validationRunId: string) =>
    Effect.sync(() => store.listArtifacts(validationRunId)),
});
