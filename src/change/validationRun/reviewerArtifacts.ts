import { Effect } from "effect";

import { encodeReviewerWireValue } from "../../agent/reviewerOutputWire.js";
import type { ReviewerAgentResult } from "../../agent/reviewerAgentRuntime.js";
import {
  InfrastructureToolingFailed,
  type ValidationToolingFailure,
} from "../validation/validationToolingFailures.js";
import { writeValidationRunArtifactFile } from "./artifactFiles.js";
import type { ValidationPhase, ValidationRunArtifactRecord } from "./validationRun.js";

export const writeReviewerArtifacts = (input: {
  readonly validationRunId: string;
  readonly phase: ValidationPhase;
  readonly producer: string;
  readonly result: ReviewerAgentResult;
  readonly artifactsRoot: string;
  readonly artifactMaxBytes?: number;
}): Effect.Effect<
  readonly Omit<ValidationRunArtifactRecord, "createdAt">[],
  ValidationToolingFailure
> =>
  Effect.try({
    try: () => {
      const contents = [
        { fileName: "stdout.txt", content: input.result.stdout },
        {
          fileName: "reviewer-output.json",
          content: input.result.ok
            ? `${encodeReviewerWireValue(input.result.report)}\n`
            : `${encodeReviewerWireValue({ error: input.result.failure._tag })}\n`,
        },
        {
          fileName: "execution.json",
          content: `${encodeReviewerWireValue({ attempts: input.result.attempts })}\n`,
        },
      ] as const;

      return contents.map(({ fileName, content }) => {
        const artifact = writeValidationRunArtifactFile({
          artifactsRoot: input.artifactsRoot,
          validationRunId: input.validationRunId,
          phase: input.phase,
          producer: input.producer,
          fileName,
          content,
          ...(input.artifactMaxBytes === undefined ? {} : { maxBytes: input.artifactMaxBytes }),
        });
        return {
          ref: `artifact:${input.validationRunId}/${input.phase}/${input.producer}/${fileName}`,
          validationRunId: input.validationRunId,
          phase: input.phase,
          producer: input.producer,
          ...artifact,
        };
      });
    },
    catch: (error) =>
      new InfrastructureToolingFailed({
        operationName: "record_reviewer_artifacts",
        message: errorMessage(error),
      }),
  });

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
