import { Effect } from "effect";

import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { ValidationToolingFailure } from "../validation/validationToolingFailures.js";
import type { CandidateValidationOutcome } from "./candidateValidationRunStore.js";

type FindingResult = {
  readonly findings: 0 | 1;
  readonly persistedToolingFailures?: readonly ValidationToolingFailure[];
  readonly toolingFailure?: ValidationToolingFailure;
};

type AcceptanceReviewResult = FindingResult;

type SpecialistReviewResult = FindingResult & {
  readonly persistedToolingFailures?: readonly ValidationToolingFailure[];
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
  readonly toolingFailures: readonly ValidationToolingFailure[];
};

export const runCandidateValidationGate = Effect.fn("CandidateValidation.runGate")(function* (
  phases: CandidateValidationGatePhases,
) {
  if (phases.prepare !== undefined) {
    const prepare = yield* phases.prepare();
    if (prepare.toolingFailure !== undefined)
      return toolingFailed(prepare.toolingFailure, prepare.persistedToolingFailures);
    if (prepare.findings === 1) return blocked;
  }

  const checks = yield* phases.checks();
  if (checks.toolingFailure !== undefined)
    return toolingFailed(checks.toolingFailure, checks.persistedToolingFailures);
  if (checks.findings === 1) return blocked;

  if (phases.acceptanceReview !== undefined) {
    const acceptance = yield* phases.acceptanceReview();
    if (acceptance.toolingFailure !== undefined)
      return toolingFailed(acceptance.toolingFailure, acceptance.persistedToolingFailures);
    if (acceptance.findings === 1) return blocked;
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
    toolingFailures: specialists.toolingFailures,
  } satisfies CandidateValidationGateResult;
});

const toolingFailed = (
  failure: ValidationToolingFailure,
  persistedFailures?: readonly ValidationToolingFailure[],
): CandidateValidationGateResult => ({
  outcome: "tooling_failed",
  ...(persistedFailures === undefined ? {} : { persistedToolingFailures: persistedFailures }),
  toolingFailures: [failure],
});

const blocked: CandidateValidationGateResult = {
  outcome: "blocked",
  toolingFailures: [],
};
