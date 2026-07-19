import { Effect, Schema } from "effect";

import { ReviewerOutputContractFailed } from "../validation/validationToolingFailures.js";
import { nonBlankStringSchema } from "./agentConfig.js";
import { contractDiagnostics, formatContractDiagnostics } from "./contractDiagnostics.js";
import { repoRelativePathSchema } from "./repoConfig.js";

const artifactRefPattern =
  /^artifact:(?:[a-z0-9][a-z0-9-]*-[0-9a-f]{12}\.v[1-9][0-9]*|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/(preflight|prepare|checks|acceptance_review|quality_review|publish_pr|watch_pr)\/[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/u;

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
