import { Data, Effect, Schema } from "effect";
import {
  type ContractDiagnostic,
  contractDiagnostics,
  formatContractDiagnostics,
} from "../contracts/contractDiagnostics.js";
import { reviewerFindingCoreSchema } from "../contracts/reviewerFinding.js";

export class ReviewerOutputContractFailed extends Data.TaggedError("ReviewerOutputContractFailed")<{
  readonly operationName: string;
  readonly reviewer: string;
  readonly attempts: number;
  readonly diagnostics: readonly ContractDiagnostic[];
  readonly message: string;
}> {}

const artifactRefPattern =
  /^artifact:(?:[a-z0-9][a-z0-9-]*-[0-9a-f]{12}\.v[1-9][0-9]*|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/(prepare|checks|acceptance_review|specialist_review)\/[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/u;

const artifactRefSchema = Schema.String.pipe(
  Schema.filter((value) => artifactRefPattern.test(value), {
    identifier: "artifact:<validation-run-id>/<phase>/<producer>/<filename>",
    message: () => "Expected artifact:<validation-run-id>/<phase>/<producer>/<filename>",
  }),
);

const validationReviewerFindingSchema = Schema.Struct({
  ...reviewerFindingCoreSchema.fields,
  artifactRefs: Schema.Array(artifactRefSchema),
});

const reviewerOutputSchema = Schema.Struct({
  findings: Schema.Array(validationReviewerFindingSchema),
});

export type ReviewerOutput = Schema.Schema.Type<typeof reviewerOutputSchema>;

export type ValidateReviewerArtifactRefsInput = {
  readonly reviewer: string;
  readonly attempts: number;
  readonly validationRunId: string;
  readonly output: ReviewerOutput;
  readonly availableArtifactRefs: readonly string[];
};

export type DecodeReviewerOutputContractInput = {
  readonly reviewer: string;
  readonly attempts: number;
  readonly output: unknown;
};

export const validateReviewerArtifactRefs = (
  input: ValidateReviewerArtifactRefsInput,
): Effect.Effect<ReviewerOutput, ReviewerOutputContractFailed> => {
  const available = new Set(input.availableArtifactRefs);
  const diagnostics = input.output.findings.flatMap((finding, findingIndex) =>
    finding.artifactRefs.flatMap((artifactRef, artifactIndex) =>
      available.has(artifactRef)
        ? []
        : [
            {
              path: ["findings", findingIndex, "artifactRefs", artifactIndex],
              expected: `a stored Artifact reference for Validation Run ${input.validationRunId}`,
              actual: artifactRef,
              message: "Artifact reference does not resolve.",
            },
          ],
    ),
  );
  return diagnostics.length === 0
    ? Effect.succeed(input.output)
    : Effect.fail(
        new ReviewerOutputContractFailed({
          operationName: "resolve_reviewer_artifact_refs",
          reviewer: input.reviewer,
          attempts: input.attempts,
          diagnostics,
          message: formatContractDiagnostics(diagnostics),
        }),
      );
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
