import { Effect, Schema } from "effect";

import { ReviewerOutputContractFailed } from "../validation/validationToolingFailures.js";
import { nonBlankStringSchema } from "./agentConfig.js";
import { contractDiagnostics, formatContractDiagnostics } from "./contractDiagnostics.js";
import { repoRelativePathSchema } from "./repoConfig.js";

const artifactRefPattern =
  /^artifact:[a-z0-9][a-z0-9-]*-[0-9a-f]{12}\.v[1-9][0-9]*\/(preflight|prepare|checks|intent_review|quality_review|publish_pr|watch_pr)\/[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/u;

const artifactRefSchema = Schema.String.pipe(
  Schema.filter((value) => artifactRefPattern.test(value), {
    identifier: "artifact:<validation-run-id>/<phase>/<producer>/<filename>",
    message: () => "Expected artifact:<validation-run-id>/<phase>/<producer>/<filename>",
  }),
);

const reviewerFindingSchema = Schema.Struct({
  title: nonBlankStringSchema,
  description: nonBlankStringSchema,
  severity: Schema.Literal("critical", "high", "medium", "low"),
  evidence: nonBlankStringSchema,
  files: Schema.Array(repoRelativePathSchema),
  artifactRefs: Schema.Array(artifactRefSchema),
});

const reviewerOutputSchema = Schema.Struct({
  findings: Schema.Array(reviewerFindingSchema),
});

export type ReviewerOutput = Schema.Schema.Type<typeof reviewerOutputSchema>;

export type DecodeReviewerOutputContractInput = {
  readonly reviewer: string;
  readonly attempts: number;
  readonly output: unknown;
};

export const decodeReviewerOutputContract = (
  input: DecodeReviewerOutputContractInput,
): Effect.Effect<ReviewerOutput, ReviewerOutputContractFailed> =>
  Schema.decodeUnknown(reviewerOutputSchema, { onExcessProperty: "error" })(input.output).pipe(
    Effect.mapError((error) => {
      const diagnostics = contractDiagnostics(error, input.output);
      return new ReviewerOutputContractFailed({
        operationName: "decode_reviewer_output",
        reviewer: input.reviewer,
        attempts: input.attempts,
        diagnostics,
        message: formatContractDiagnostics(diagnostics),
      });
    }),
  );
