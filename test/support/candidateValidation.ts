import { Effect, Layer } from "effect";

import {
  piReviewerAgentRuntime,
  type ReviewerAgentRuntime,
} from "../../src/agent/reviewerAgentRuntime.js";
import {
  CandidateValidation,
  CandidateValidationLive,
  CandidateValidationPaths,
  CandidateValidationRunStore,
  CandidateReviewerAgentRuntime,
  type CandidateValidationService,
} from "../../src/candidateValidation/validateCandidate.js";
import type { CandidateValidationRunStore as CandidateValidationRunStorePort } from "../../src/candidateValidation/candidateValidationRunStore.js";

export const candidateValidationForTest = (input: {
  readonly localRepositoryMainCheckoutRoot: string;
  readonly artifactsRoot: string;
  readonly runStore: CandidateValidationRunStorePort;
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime;
}): CandidateValidationService => {
  const layer = CandidateValidationLive.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(CandidateValidationPaths, {
          localRepositoryMainCheckoutRoot: input.localRepositoryMainCheckoutRoot,
          artifactsRoot: input.artifactsRoot,
        }),
        Layer.succeed(CandidateValidationRunStore, input.runStore),
        Layer.succeed(
          CandidateReviewerAgentRuntime,
          input.reviewerAgentRuntime ?? piReviewerAgentRuntime,
        ),
      ),
    ),
  );
  return Effect.runSync(
    Effect.gen(function* () {
      return yield* CandidateValidation;
    }).pipe(Effect.provide(layer)),
  );
};
