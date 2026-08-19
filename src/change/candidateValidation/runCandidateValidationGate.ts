import { Effect } from "effect";

import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { ValidationToolingFailure } from "../validation/validationToolingFailures.js";
import type { CandidateValidationOutcome } from "./candidateValidationRunStore.js";

type PhaseResult = {
  readonly outcome: CandidateValidationOutcome;
};

type CandidateValidationGatePhases = {
  readonly prepare?: () => Effect.Effect<
    PhaseResult,
    ValidationToolingFailure | RepositoryStorageError
  >;
  readonly checks: () => Effect.Effect<
    PhaseResult,
    ValidationToolingFailure | RepositoryStorageError
  >;
  readonly acceptanceReview?: () => Effect.Effect<
    PhaseResult,
    ValidationToolingFailure | RepositoryStorageError
  >;
  readonly specialistReviews: () => Effect.Effect<
    PhaseResult,
    ValidationToolingFailure | RepositoryStorageError
  >;
};

export const runCandidateValidationGate = Effect.fn("CandidateValidation.runGate")(function* (
  phases: CandidateValidationGatePhases,
) {
  if (phases.prepare !== undefined) {
    const prepare = yield* phases.prepare();
    if (prepare.outcome !== "passed") return prepare;
  }

  const checks = yield* phases.checks();
  if (checks.outcome !== "passed") return checks;

  if (phases.acceptanceReview !== undefined) {
    const acceptance = yield* phases.acceptanceReview();
    if (acceptance.outcome !== "passed") return acceptance;
  }

  return yield* phases.specialistReviews();
});
