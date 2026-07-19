import type { Sandbox } from "@ai-hero/sandcastle";
import { Effect } from "effect";

import type { SpecialistReviewPolicy } from "./specialistReviewConfig.js";
import type { ReviewerAgentRuntime } from "../agent/reviewerAgentRuntime.js";
import { buildSpecialistReviewerPrompt } from "../agent/reviewerPrompts.js";
import type { RecordCandidateSpecialistRoundInput } from "../candidateValidation/candidateValidationRunStore.js";
import { ensureCandidateIntegrity } from "../validation/ensureCandidateIntegrity.js";
import {
  InfrastructureToolingFailed,
  type ValidationToolingFailure,
} from "../validation/validationToolingFailures.js";
import { writeReviewerArtifacts } from "../validationRun/reviewerArtifacts.js";
import { validationPhase, type ValidationPhase } from "../validationRun/validationRun.js";

export type RunSpecialistReviewPhaseInput = {
  readonly validationRunId: string;
  readonly candidate: {
    readonly candidateId: string;
    readonly comparisonBaseSha: string;
    readonly headSha: string;
  };
  readonly policies: readonly SpecialistReviewPolicy[];
  readonly runtime: ReviewerAgentRuntime;
  readonly sandbox: Pick<Sandbox, "exec" | "run">;
  readonly artifactsRoot: string;
  readonly artifactMaxBytes?: number;
  readonly commandCwd: string;
  readonly allowedUntrackedFiles: readonly string[];
  readonly now: string;
  readonly listArtifacts: (
    validationRunId: string,
  ) => readonly { readonly ref: string; readonly phase: ValidationPhase }[];
  readonly recordSpecialistRound: (input: RecordCandidateSpecialistRoundInput) => void;
};

export type RunSpecialistReviewPhaseResult = {
  readonly findings: 0 | 1;
  readonly toolingFailures: readonly ValidationToolingFailure[];
};

export const runSpecialistReviewPhase = (
  input: RunSpecialistReviewPhaseInput,
): Effect.Effect<RunSpecialistReviewPhaseResult, ValidationToolingFailure> =>
  Effect.gen(function* () {
    let hasFindings = false;
    const toolingFailures: ValidationToolingFailure[] = [];

    for (const [index, policy] of input.policies.entries()) {
      const result = yield* runSpecialist(input, policy, index + 1);
      if (result.hasFindings) hasFindings = true;
      if (result.toolingFailure !== undefined) toolingFailures.push(result.toolingFailure);
    }

    return { findings: hasFindings ? 1 : 0, toolingFailures };
  });

const runSpecialist = (
  input: RunSpecialistReviewPhaseInput,
  policy: SpecialistReviewPolicy,
  roundNumber: number,
): Effect.Effect<
  { readonly hasFindings: boolean; readonly toolingFailure?: ValidationToolingFailure },
  ValidationToolingFailure
> =>
  Effect.gen(function* () {
    yield* verifyIntegrity(input);
    const availableArtifactRefs = repositoryEvidenceRefs(input);
    const result = yield* input.runtime.review({
      sandbox: input.sandbox,
      reviewer: policy.id,
      validationRunId: input.validationRunId,
      availableArtifactRefs,
      prompt: buildSpecialistReviewerPrompt({
        specialist: policy.id,
        instructions: policy.instructions,
        validationRunId: input.validationRunId,
        availableArtifactRefs,
        candidate: input.candidate,
      }),
      profile: policy.profile,
    });
    yield* verifyIntegrity(input);
    const artifacts = yield* writeReviewerArtifacts({
      validationRunId: input.validationRunId,
      phase: validationPhase.qualityReview,
      producer: policy.id,
      result,
      artifactsRoot: input.artifactsRoot,
      ...(input.artifactMaxBytes === undefined ? {} : { artifactMaxBytes: input.artifactMaxBytes }),
    });
    const findings = result.ok
      ? result.report.findings.map((finding, findingIndex) => ({
          id: `${input.validationRunId}-${policy.id}-F${findingIndex + 1}`,
          validationRunId: input.validationRunId,
          phase: validationPhase.qualityReview,
          producer: policy.id,
          ...finding,
        }))
      : [];
    const passed = result.ok && findings.length === 0;

    yield* recordSpecialistRound(input, {
      validationRunId: input.validationRunId,
      producer: policy.id,
      roundNumber,
      roundStatus: passed ? "passed" : "failed",
      phaseStatus: passed ? "passed" : "failed",
      artifactRecords: artifacts,
      findings,
      now: input.now,
    });

    return {
      hasFindings: findings.length > 0,
      ...(result.ok ? {} : { toolingFailure: result.failure }),
    };
  });

const repositoryEvidenceRefs = (input: RunSpecialistReviewPhaseInput): readonly string[] =>
  input
    .listArtifacts(input.validationRunId)
    .filter(
      (artifact) =>
        artifact.phase === validationPhase.prepare || artifact.phase === validationPhase.checks,
    )
    .map((artifact) => artifact.ref);

const verifyIntegrity = (
  input: RunSpecialistReviewPhaseInput,
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
            operationName: "verify_specialist_candidate",
            message: errorMessage(error),
          }),
  });

const recordSpecialistRound = (
  input: RunSpecialistReviewPhaseInput,
  round: RecordCandidateSpecialistRoundInput,
): Effect.Effect<void, ValidationToolingFailure> =>
  Effect.try({
    try: () => input.recordSpecialistRound(round),
    catch: (error) =>
      new InfrastructureToolingFailed({
        operationName: "record_specialist_round",
        message: errorMessage(error),
      }),
  });

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
