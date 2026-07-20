import { Layer } from "effect";

import {
  piReviewerAgentRuntime,
  type ReviewerAgentRuntime,
} from "../../src/agent/reviewerAgentRuntime.js";
import {
  CandidateValidationLive,
  CandidateValidationPaths,
  CandidateValidationRunStore,
  CandidateReviewerAgentRuntime,
} from "../../src/candidateValidation/validateCandidate.js";
import type { CandidateValidationRunStore as CandidateValidationRunStorePort } from "../../src/candidateValidation/candidateValidationRunStore.js";

export const candidateValidationForTest = (input: {
  readonly localRepositoryMainCheckoutRoot: string;
  readonly artifactsRoot: string;
  readonly runStore: CandidateValidationRunStorePort;
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime;
}) => {
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
