import { Layer } from "effect";

import {
  type CandidateValidation,
  CandidateValidationLive,
  CandidateValidationPaths,
  CandidateValidationPersistence,
  CandidateReviewerAgentRuntime,
} from "../candidateValidation/validateCandidate.js";
import type { ChangeValidationPersistence } from "../changeValidation/changeValidationPersistence.js";
import {
  piReviewerAgentRuntime,
  type ReviewerAgentRuntime,
} from "../agent/reviewerAgentRuntime.js";

export const localCandidateValidationLayer = (input: {
  readonly localRepositoryMainCheckoutRoot: string;
  readonly artifactsRoot: string;
  readonly persistence: ChangeValidationPersistence;
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime;
}): Layer.Layer<CandidateValidation, never, never> =>
  CandidateValidationLive.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(CandidateValidationPaths, {
          localRepositoryMainCheckoutRoot: input.localRepositoryMainCheckoutRoot,
          artifactsRoot: input.artifactsRoot,
        }),
        Layer.succeed(CandidateValidationPersistence, input.persistence),
        Layer.succeed(
          CandidateReviewerAgentRuntime,
          input.reviewerAgentRuntime ?? piReviewerAgentRuntime,
        ),
      ),
    ),
  );
