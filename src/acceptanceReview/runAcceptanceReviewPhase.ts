import type { Sandbox } from "@ai-hero/sandcastle";
import { Effect } from "effect";

import type { AcceptanceReviewPolicy } from "./acceptanceReviewConfig.js";
import type { ReviewerAgentRuntime } from "../agent/reviewerAgentRuntime.js";
import {
  buildAcceptanceReviewerPrompt,
  buildReviewerRevisionPrompt,
  reviewerFindingHistory,
} from "../agent/reviewerPrompts.js";
import type { TaskContextSnapshotV1 } from "../validationRun/taskContextSnapshot.js";
import { validationPhase } from "../validationRun/validationRun.js";
import { writeReviewerArtifacts } from "../validationRun/reviewerArtifacts.js";
import type { RecordCandidateAcceptanceRoundInput } from "../candidateValidation/candidateValidationRunStore.js";
import { ensureCandidateIntegrity } from "../validation/ensureCandidateIntegrity.js";
import {
  InfrastructureToolingFailed,
  type ValidationToolingFailure,
} from "../validation/validationToolingFailures.js";

export type RunAcceptanceReviewPhaseInput = {
  readonly validationRunId: string;
  readonly candidate: {
    readonly candidateId: string;
    readonly comparisonBaseSha: string;
    readonly headSha: string;
  };
  readonly acceptanceContext: TaskContextSnapshotV1;
  readonly policy: AcceptanceReviewPolicy;
  readonly runtime: ReviewerAgentRuntime;
  readonly sandbox: Pick<Sandbox, "exec" | "run">;
  readonly artifactsRoot: string;
  readonly artifactMaxBytes?: number;
  readonly commandCwd: string;
  readonly allowedUntrackedFiles: readonly string[];
  readonly now: string;
  readonly listArtifacts: (validationRunId: string) => readonly { readonly ref: string }[];
  readonly listPreviousCandidateReviewerFindings: (input: {
    readonly candidateId: string;
    readonly phase: "acceptance_review";
    readonly producer: "acceptance";
  }) => readonly {
    readonly title: string;
    readonly description: string;
    readonly severity?: "critical" | "high" | "medium" | "low";
    readonly evidence: string;
    readonly files: readonly string[];
    readonly artifactRefs: readonly string[];
  }[];
  readonly recordAcceptanceRound: (input: RecordCandidateAcceptanceRoundInput) => void;
};

export type RunAcceptanceReviewPhaseResult = {
  readonly findings: 0 | 1;
};

export const runAcceptanceReviewPhase = (
  input: RunAcceptanceReviewPhaseInput,
): Effect.Effect<RunAcceptanceReviewPhaseResult, ValidationToolingFailure> =>
  Effect.gen(function* () {
    yield* verifyIntegrity(input);
    const availableArtifactRefs = input
      .listArtifacts(input.validationRunId)
      .map((artifact) => artifact.ref);
    const prompt = buildAcceptanceReviewerPrompt({
      instructions: input.policy.instructions,
      validationRunId: input.validationRunId,
      availableArtifactRefs,
      candidate: input.candidate,
      acceptanceContext: input.acceptanceContext,
    });
    const earlierFindings = reviewerFindingHistory(
      input.listPreviousCandidateReviewerFindings({
        candidateId: input.candidate.candidateId,
        phase: validationPhase.acceptanceReview,
        producer: "acceptance",
      }),
    );
    const provisional = yield* input.runtime.review({
      sandbox: input.sandbox,
      reviewer: "acceptance",
      validationRunId: input.validationRunId,
      availableArtifactRefs,
      prompt,
      profile: input.policy.profile,
    });
    yield* verifyIntegrity(input);
    const result =
      provisional.ok && earlierFindings.length > 0
        ? yield* input.runtime.review({
            sandbox: input.sandbox,
            reviewer: "acceptance",
            validationRunId: input.validationRunId,
            availableArtifactRefs,
            prompt: buildReviewerRevisionPrompt({
              reviewPrompt: prompt,
              provisionalReport: provisional.report,
              earlierFindings,
            }),
            profile: input.policy.profile,
          })
        : provisional;
    if (result !== provisional) yield* verifyIntegrity(input);
    const artifacts = yield* writeReviewerArtifacts({
      validationRunId: input.validationRunId,
      phase: validationPhase.acceptanceReview,
      producer: "acceptance",
      result,
      artifactsRoot: input.artifactsRoot,
      ...(input.artifactMaxBytes === undefined ? {} : { artifactMaxBytes: input.artifactMaxBytes }),
    });
    const findings = result.ok
      ? result.report.findings.map((finding, index) => ({
          id: `${input.validationRunId}-acceptance-F${index + 1}`,
          validationRunId: input.validationRunId,
          phase: validationPhase.acceptanceReview,
          producer: "acceptance",
          ...finding,
        }))
      : [];

    yield* recordAcceptanceRound(input, {
      validationRunId: input.validationRunId,
      roundNumber: 1,
      roundStatus: result.ok && findings.length === 0 ? "passed" : "failed",
      phaseStatus: result.ok && findings.length === 0 ? "passed" : "failed",
      artifactRecords: artifacts,
      findings,
      now: input.now,
    });

    if (!result.ok) return yield* Effect.fail(result.failure);
    return { findings: findings.length === 0 ? 0 : 1 };
  });

const verifyIntegrity = (
  input: RunAcceptanceReviewPhaseInput,
): Effect.Effect<void, ValidationToolingFailure> =>
  Effect.tryPromise({
    try: () =>
      ensureCandidateIntegrity({
        sandbox: input.sandbox,
        commandCwd: input.commandCwd,
        expectedHeadSha: input.candidate.headSha,
        allowedUntrackedFiles: input.allowedUntrackedFiles,
      }),
    catch: (error) =>
      error instanceof Error && "_tag" in error
        ? (error as ValidationToolingFailure)
        : new InfrastructureToolingFailed({
            operationName: "verify_acceptance_candidate",
            message: errorMessage(error),
          }),
  });

const recordAcceptanceRound = (
  input: RunAcceptanceReviewPhaseInput,
  round: RecordCandidateAcceptanceRoundInput,
): Effect.Effect<void, ValidationToolingFailure> =>
  Effect.try({
    try: () => input.recordAcceptanceRound(round),
    catch: (error) =>
      new InfrastructureToolingFailed({
        operationName: "record_acceptance_round",
        message: errorMessage(error),
      }),
  });

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
