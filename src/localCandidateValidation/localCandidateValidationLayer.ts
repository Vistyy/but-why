import { Layer } from "effect";

import {
  type CandidateValidation,
  CandidateValidationLive,
  CandidateValidationPaths,
  CandidateValidationRunStore,
  CandidateReviewerAgentRuntime,
} from "../candidateValidation/validateCandidate.js";
import type { CandidateValidationRunStore as CandidateValidationRunStorePort } from "../candidateValidation/candidateValidationRunStore.js";
import { piReviewerAgentRuntime } from "../agent/reviewerAgentRuntime.js";

export const localCandidateValidationLayer = (input: {
  readonly localRepositoryMainCheckoutRoot: string;
  readonly artifactsRoot: string;
  readonly runStore: CandidateValidationRunStorePort;
}): Layer.Layer<CandidateValidation, never, never> =>
  CandidateValidationLive.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(CandidateValidationPaths, {
          localRepositoryMainCheckoutRoot: input.localRepositoryMainCheckoutRoot,
          artifactsRoot: input.artifactsRoot,
        }),
        Layer.succeed(CandidateValidationRunStore, input.runStore),
        Layer.succeed(CandidateReviewerAgentRuntime, piReviewerAgentRuntime),
      ),
    ),
  );
