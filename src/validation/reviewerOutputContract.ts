import { Effect, Schema } from "effect";

import { ReviewerOutputContractFailed } from "./validationToolingFailures.js";

const reviewerFindingSchema = Schema.Struct({
  title: Schema.String,
  description: Schema.String,
  severity: Schema.Literal("critical", "high", "medium", "low"),
  evidence: Schema.String,
  files: Schema.Array(Schema.String),
  artifactRefs: Schema.Array(Schema.String),
});

const reviewerOutputContractSchema = Schema.Struct({
  findings: Schema.Array(reviewerFindingSchema),
});

type ReviewerOutputContract = Schema.Schema.Type<typeof reviewerOutputContractSchema>;

export type DecodeReviewerOutputContractInput = {
  readonly reviewer: string;
  readonly attempts: number;
  readonly output: unknown;
};

export const decodeReviewerOutputContract = (
  input: DecodeReviewerOutputContractInput,
): Effect.Effect<ReviewerOutputContract, ReviewerOutputContractFailed> =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(reviewerOutputContractSchema)(input.output),
    catch: (error) =>
      new ReviewerOutputContractFailed({
        operationName: "decode_reviewer_output",
        reviewer: input.reviewer,
        attempts: input.attempts,
        message: errorMessage(error),
      }),
  });

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
