import { Layer } from "effect";
import {
  piReviewerAgentRuntime,
  type ReviewerAgentRuntime,
} from "../../agent/reviewerAgentRuntime.js";
import type { ChangeValidationPersistence } from "../validation/changeValidationPersistence.js";
import {
  CandidateReviewerAgentRuntime,
  type CandidateValidation,
  CandidateValidationLive,
  CandidateValidationPaths,
  CandidateValidationPersistence,
} from "./validateCandidate.js";

export const candidateValidationLayer = (input: {
  readonly localRepositoryMainCheckoutRoot: string;
  readonly artifactsRoot: string;
  readonly persistence: ChangeValidationPersistence;
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime;
  readonly sessionStore?: unknown;
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
          ...(input.sessionStore === undefined
            ? {}
            : {
                sessionStore:
                  input.sessionStore as import("../reviewerSession/reviewerSession.js").ReviewerSessionStore,
              }),
        }),
        Layer.succeed(CandidateValidationPersistence, input.persistence),
        Layer.succeed(
          CandidateReviewerAgentRuntime,
          input.reviewerAgentRuntime ?? piReviewerAgentRuntime,
        ),
      ),
    ),
  );
