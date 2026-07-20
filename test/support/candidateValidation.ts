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

type CandidateValidationTestHarness = Omit<CandidateValidationService, "listRounds"> &
  Pick<
    CandidateValidationRunStorePort,
    "listFindings" | "listArtifacts" | "listToolingFailures"
  > & {
    readonly listRounds: (validationRunId: string) => readonly {
      readonly producer: string;
      readonly status: "passed" | "failed";
    }[];
  };

export const candidateValidationForTest = (input: {
  readonly localRepositoryMainCheckoutRoot: string;
  readonly artifactsRoot: string;
  readonly runStore: CandidateValidationRunStorePort;
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime;
}): CandidateValidationTestHarness => {
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
  const validation = Effect.runSync(
    Effect.gen(function* () {
      return yield* CandidateValidation;
    }).pipe(Effect.provide(layer)),
  );
  return {
    ...validation,
    listRounds: (validationRunId) =>
      input.runStore
        .listRounds(validationRunId)
        .map(({ producer, status }) => ({ producer, status })),
    listFindings: input.runStore.listFindings,
    listArtifacts: input.runStore.listArtifacts,
    listToolingFailures: input.runStore.listToolingFailures,
  };
};
