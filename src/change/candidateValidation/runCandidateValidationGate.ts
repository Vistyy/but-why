import { Effect } from "effect";

import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { SpecialistReviewerContinuityEvidence } from "../specialistReview/runSpecialistReviewPhase.js";
import type { ValidationToolingFailure } from "../validation/validationToolingFailures.js";
import type { ReviewerExecutionEvidence } from "../validationRun/reviewerArtifacts.js";
import type { CandidateValidationOutcome } from "./candidateValidationRunStore.js";

type FindingResult = {
  readonly findings: 0 | 1;
};

type AcceptanceReviewResult = FindingResult & {
  readonly persistedToolingFailures?: readonly ValidationToolingFailure[];
  readonly reviewerEvidence?: ReviewerExecutionEvidence;
  readonly toolingFailure?: ValidationToolingFailure;
};

type SpecialistReviewResult = FindingResult & {
  readonly persistedToolingFailures?: readonly ValidationToolingFailure[];
  readonly reviewerEvidence: readonly SpecialistReviewerContinuityEvidence[];
  readonly toolingFailures: readonly ValidationToolingFailure[];
};

type CandidateValidationGatePhases = {
  readonly prepare?: () => Effect.Effect<
    FindingResult,
    ValidationToolingFailure | RepositoryStorageError
  >;
  readonly checks: () => Effect.Effect<
    FindingResult,
    ValidationToolingFailure | RepositoryStorageError
  >;
  readonly acceptanceReview?: () => Effect.Effect<
    AcceptanceReviewResult,
    ValidationToolingFailure | RepositoryStorageError
  >;
  readonly specialistReviews: () => Effect.Effect<
    SpecialistReviewResult,
    ValidationToolingFailure | RepositoryStorageError
  >;
};

type CandidateValidationGateResult = {
  readonly outcome: CandidateValidationOutcome;
  readonly persistedToolingFailures?: readonly ValidationToolingFailure[];
  readonly reviewerEvidence?: ReviewerExecutionEvidence;
  readonly specialistReviewerEvidence?: readonly SpecialistReviewerContinuityEvidence[];
  readonly toolingFailures: readonly ValidationToolingFailure[];
};

export const runCandidateValidationGate = Effect.fn("CandidateValidation.runGate")(function* (
  phases: CandidateValidationGatePhases,
) {
  if (phases.prepare !== undefined) {
    const prepare = yield* phases.prepare();
    if (prepare.findings === 1) return blocked;
  }

  const checks = yield* phases.checks();
  if (checks.findings === 1) return blocked;

  let reviewerEvidence: ReviewerExecutionEvidence | undefined;
  if (phases.acceptanceReview !== undefined) {
    const acceptance = yield* phases.acceptanceReview();
    reviewerEvidence = acceptance.reviewerEvidence;
    if (acceptance.toolingFailure !== undefined) {
      return {
        outcome: "tooling_failed",
        ...(acceptance.persistedToolingFailures === undefined
          ? {}
          : { persistedToolingFailures: acceptance.persistedToolingFailures }),
        ...(reviewerEvidence === undefined ? {} : { reviewerEvidence }),
        toolingFailures: [acceptance.toolingFailure],
      } satisfies CandidateValidationGateResult;
    }
    if (acceptance.findings === 1) {
      return {
        outcome: "blocked",
        ...(reviewerEvidence === undefined ? {} : { reviewerEvidence }),
        toolingFailures: [],
      } satisfies CandidateValidationGateResult;
    }
  }

  const specialists = yield* phases.specialistReviews();
  const outcome: CandidateValidationOutcome =
    specialists.toolingFailures.length > 0
      ? "tooling_failed"
      : specialists.findings === 1
        ? "blocked"
        : "passed";
  return {
    outcome,
    ...(specialists.persistedToolingFailures === undefined
      ? {}
      : { persistedToolingFailures: specialists.persistedToolingFailures }),
    ...(reviewerEvidence === undefined ? {} : { reviewerEvidence }),
    ...(specialists.reviewerEvidence.length === 0
      ? {}
      : { specialistReviewerEvidence: specialists.reviewerEvidence }),
    toolingFailures: specialists.toolingFailures,
  } satisfies CandidateValidationGateResult;
});

const blocked: CandidateValidationGateResult = {
  outcome: "blocked",
  toolingFailures: [],
};
