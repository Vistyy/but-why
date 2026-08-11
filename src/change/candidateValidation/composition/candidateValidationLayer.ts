import { Layer } from "effect";
import { piReviewerProcessExecutor } from "../../../agent/piReviewerProcessExecutor.js";
import {
  piReviewerAgentRuntime,
  type ReviewerAgentRuntime,
} from "../../../agent/reviewerAgentRuntime.js";
import type { ReviewerOutput } from "../../../contracts/reviewerOutput.js";
import type { ReviewerSessionStore } from "../../reviewerSession/reviewerSession.js";
import type { CandidateValidationExecutionPort } from "../../validation/changeValidationPorts.js";
import {
  CandidateReviewerExecution,
  type CandidateValidation,
  CandidateValidationExecution,
  CandidateValidationLive,
  CandidateValidationPaths,
} from "../validateCandidate.js";

export const candidateValidationLayer = (input: {
  readonly localRepositoryMainCheckoutRoot: string;
  readonly artifactsRoot: string;
  readonly persistence: CandidateValidationExecutionPort;
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime<ReviewerOutput>;
  readonly sessionStore?: ReviewerSessionStore;
  readonly reviewerSessionsRoot?: string;
}): Layer.Layer<CandidateValidation, never, never> =>
  CandidateValidationLive.pipe(
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
        Layer.succeed(CandidateValidationExecution, input.persistence),
        Layer.succeed(CandidateReviewerExecution, {
          runtime: input.reviewerAgentRuntime ?? piReviewerAgentRuntime,
          processExecutor: piReviewerProcessExecutor,
        }),
      ),
    ),
  );
