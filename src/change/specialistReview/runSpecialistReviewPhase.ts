import type { Sandbox } from "@ai-hero/sandcastle";
import { Effect } from "effect";

import type { SpecialistReviewPolicy } from "./specialistReviewConfig.js";
import type { ReviewerAgentRuntime } from "../../agent/reviewerAgentRuntime.js";
import {
  buildReviewerRevisionPrompt,
  buildSpecialistReviewerPrompt,
  reviewerFindingHistory,
} from "../../agent/reviewerPrompts.js";
import type { RecordCandidateSpecialistRoundInput } from "../candidateValidation/candidateValidationRunStore.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { ValidationToolingFailure } from "../validation/validationToolingFailures.js";
import { verifyCandidateIntegrity } from "../validation/verifyCandidateIntegrity.js";
import { writeReviewerArtifacts } from "../validationRun/reviewerArtifacts.js";
import { validationPhase } from "../validationRun/validationRun.js";

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
  readonly listPreviousCandidateReviewerFindings: (input: {
    readonly candidateId: string;
    readonly phase: "specialist_review";
    readonly producer: string;
  }) => Effect.Effect<
    readonly {
      readonly title: string;
      readonly description: string;
      readonly severity?: "critical" | "high" | "medium" | "low";
      readonly evidence: string;
      readonly files: readonly string[];
      readonly artifactRefs: readonly string[];
    }[],
    RepositoryStorageError
  >;
  readonly recordSpecialistRound: (
    input: RecordCandidateSpecialistRoundInput,
  ) => Effect.Effect<void, RepositoryStorageError>;
};

export type RunSpecialistReviewPhaseResult = {
  readonly findings: 0 | 1;
  readonly toolingFailures: readonly ValidationToolingFailure[];
};

export const runSpecialistReviewPhase = (
  input: RunSpecialistReviewPhaseInput,
): Effect.Effect<
  RunSpecialistReviewPhaseResult,
  ValidationToolingFailure | RepositoryStorageError
> =>
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
  ValidationToolingFailure | RepositoryStorageError
> =>
  Effect.gen(function* () {
    yield* verifyIntegrity(input);
    const prompt = buildSpecialistReviewerPrompt({
      specialist: policy.id,
      instructions: policy.instructions,
      validationRunId: input.validationRunId,
      candidate: {
        comparisonBaseSha: input.candidate.comparisonBaseSha,
        headSha: input.candidate.headSha,
      },
    });
    const earlierFindings = reviewerFindingHistory(
      yield* input.listPreviousCandidateReviewerFindings({
        candidateId: input.candidate.candidateId,
        phase: validationPhase.specialistReview,
        producer: policy.id,
      }),
    );
    const provisional = yield* input.runtime.review({
      sandbox: input.sandbox,
      reviewer: policy.id,
      validationRunId: input.validationRunId,
      availableArtifactRefs: [],
      prompt,
      profile: policy.profile,
    });
    yield* verifyIntegrity(input);
    const result =
      provisional.ok && earlierFindings.length > 0
        ? yield* input.runtime.review({
            sandbox: input.sandbox,
            reviewer: policy.id,
            validationRunId: input.validationRunId,
            availableArtifactRefs: [],
            prompt: buildReviewerRevisionPrompt({
              reviewPrompt: prompt,
              provisionalReport: provisional.report,
              earlierFindings,
            }),
            profile: policy.profile,
          })
        : provisional;
    if (result !== provisional) yield* verifyIntegrity(input);
    const artifacts = yield* writeReviewerArtifacts({
      validationRunId: input.validationRunId,
      phase: validationPhase.specialistReview,
      producer: policy.id,
      result,
      artifactsRoot: input.artifactsRoot,
      ...(input.artifactMaxBytes === undefined ? {} : { artifactMaxBytes: input.artifactMaxBytes }),
    });
    const findings = result.ok
      ? result.report.findings.map((finding, findingIndex) => ({
          id: `${input.validationRunId}-${policy.id}-F${findingIndex + 1}`,
          validationRunId: input.validationRunId,
          phase: validationPhase.specialistReview,
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

const verifyIntegrity = (
  input: RunSpecialistReviewPhaseInput,
): Effect.Effect<void, ValidationToolingFailure> =>
  verifyCandidateIntegrity({
    sandbox: input.sandbox,
    commandCwd: input.commandCwd,
    expectedHeadSha: input.candidate.headSha,
    allowedUntrackedFiles: input.allowedUntrackedFiles,
    operationName: "verify_specialist_candidate",
  });

const recordSpecialistRound = (
  input: RunSpecialistReviewPhaseInput,
  round: RecordCandidateSpecialistRoundInput,
): Effect.Effect<void, RepositoryStorageError> => input.recordSpecialistRound(round);
