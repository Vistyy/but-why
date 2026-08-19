import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { runCandidateValidationGate } from "../../src/change/candidateValidation/runCandidateValidationGate.js";

const passed = { outcome: "passed" as const };
const blocked = { outcome: "blocked" as const };
const toolingFailed = { outcome: "tooling_failed" as const };
const record = <A>(calls: string[], phase: string, result: A) =>
  Effect.sync(() => {
    calls.push(phase);
    return result;
  });

describe("Candidate Validation Gate", () => {
  it.effect("omits Acceptance Review for a Change without a Task Candidate", () =>
    Effect.gen(function* () {
      const calls: string[] = [];

      const result = yield* runCandidateValidationGate({
        checks: () => record(calls, "checks", passed),
        specialistReviews: () => record(calls, "specialists", passed),
      });

      expect(result).toEqual(passed);
      expect(calls).toEqual(["checks", "specialists"]);
    }),
  );

  it.effect("stops after blocking Repository Preparation or Checks", () =>
    Effect.gen(function* () {
      const prepareCalls: string[] = [];
      const prepareResult = yield* runCandidateValidationGate({
        prepare: () => record(prepareCalls, "prepare", blocked),
        checks: () => record(prepareCalls, "checks", passed),
        acceptanceReview: () => record(prepareCalls, "acceptance", passed),
        specialistReviews: () => record(prepareCalls, "specialists", passed),
      });
      expect(prepareResult).toEqual(blocked);
      expect(prepareCalls).toEqual(["prepare"]);

      const checkCalls: string[] = [];
      const checkResult = yield* runCandidateValidationGate({
        prepare: () => record(checkCalls, "prepare", passed),
        checks: () => record(checkCalls, "checks", blocked),
        acceptanceReview: () => record(checkCalls, "acceptance", passed),
        specialistReviews: () => record(checkCalls, "specialists", passed),
      });
      expect(checkResult).toEqual(blocked);
      expect(checkCalls).toEqual(["prepare", "checks"]);
    }),
  );

  it.effect("stops after Prepare, Check, or Acceptance Tooling Failure", () =>
    Effect.gen(function* () {
      for (const failedPhase of ["prepare", "checks", "acceptance"] as const) {
        const calls: string[] = [];
        const result = yield* runCandidateValidationGate({
          prepare: () =>
            record(calls, "prepare", failedPhase === "prepare" ? toolingFailed : passed),
          checks: () => record(calls, "checks", failedPhase === "checks" ? toolingFailed : passed),
          acceptanceReview: () =>
            record(calls, "acceptance", failedPhase === "acceptance" ? toolingFailed : passed),
          specialistReviews: () => record(calls, "specialists", passed),
        });

        expect(result).toEqual(toolingFailed);
        expect(calls.at(-1)).toBe(failedPhase);
      }
    }),
  );

  it.effect("returns the Specialist outcome", () =>
    Effect.gen(function* () {
      for (const specialistResult of [passed, blocked, toolingFailed]) {
        const result = yield* runCandidateValidationGate({
          checks: () => Effect.succeed(passed),
          specialistReviews: () => Effect.succeed(specialistResult),
        });
        expect(result).toEqual(specialistResult);
      }
    }),
  );
});
