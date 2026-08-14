import type * as FileSystem from "@effect/platform/FileSystem";
import { Effect } from "effect";
import type { AgentExecutionEvidence } from "../../agent/agentSession/executeAgentSession.js";
import { encodeReviewerWireValue } from "../../agent/reviewerOutputWire.js";
import type { ReviewerExecutionEvidence } from "../../agent/reviewerSession/executeReviewerSession.js";

export type { ReviewerExecutionEvidence } from "../../agent/reviewerSession/executeReviewerSession.js";

export const reviewerEvidenceFromAgentSession = (
  evidence: AgentExecutionEvidence,
): ReviewerExecutionEvidence => ({
  agentSessionId: evidence.agentSessionId,
  invocations: evidence.invocations,
});

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
  readonly result:
    | {
        readonly ok: true;
        readonly report: unknown;
        readonly attempts: number;
        readonly stdout: string;
      }
    | {
        readonly ok: false;
        readonly failure: ValidationToolingFailure;
        readonly attempts: number;
        readonly stdout: string;
      };
  readonly artifactsRoot: string;
  readonly artifactMaxBytes?: number;
  readonly executionEvidence: ReviewerExecutionEvidence;
}): Effect.Effect<
  readonly Omit<ValidationRunArtifactRecord, "createdAt">[],
  ValidationToolingFailure,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
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
        content: `${encodeReviewerWireValue(executionArtifact(input.executionEvidence, input.result.attempts))}\n`,
      },
    ] as const;

    const artifacts: Omit<ValidationRunArtifactRecord, "createdAt">[] = [];
    for (const { fileName, content } of contents) {
      const artifact = yield* writeValidationRunArtifactFile({
        artifactsRoot: input.artifactsRoot,
        validationRunId: input.validationRunId,
        phase: input.phase,
        producer: input.producer,
        fileName,
        content,
        ...(input.artifactMaxBytes === undefined ? {} : { maxBytes: input.artifactMaxBytes }),
      });
      artifacts.push({
        ref: `artifact:${input.validationRunId}/${input.phase}/${input.producer}/${fileName}`,
        validationRunId: input.validationRunId,
        phase: input.phase,
        producer: input.producer,
        ...artifact,
      });
    }
    return artifacts;
  }).pipe(
    Effect.mapError(
      (error) =>
        new InfrastructureToolingFailed({
          operationName: "record_reviewer_artifacts",
          message: errorMessage(error),
        }),
    ),
  );

const executionArtifact = (evidence: ReviewerExecutionEvidence, attempts: number): unknown =>
  evidence.invocations === undefined
    ? { ...evidence, attempts }
    : {
        agentSessionId: evidence.agentSessionId,
        invocations: evidence.invocations,
        attempts,
      };

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
