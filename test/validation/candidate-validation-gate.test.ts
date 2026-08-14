import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { runCandidateValidationGate } from "../../src/change/candidateValidation/runCandidateValidationGate.js";
import { ReviewerProcessToolingFailed } from "../../src/change/validation/validationToolingFailures.js";

const passed = { findings: 0 as const };
const blocked = { findings: 1 as const };
const specialistsPassed = {
  findings: 0 as const,
  reviewerEvidence: [],
  toolingFailures: [],
};
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
        specialistReviews: () => record(calls, "specialists", specialistsPassed),
      });

      expect(result).toEqual({ outcome: "passed", toolingFailures: [] });
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
        specialistReviews: () => record(prepareCalls, "specialists", specialistsPassed),
      });
      expect(prepareResult.outcome).toBe("blocked");
      expect(prepareCalls).toEqual(["prepare"]);

      const checkCalls: string[] = [];
      const checkResult = yield* runCandidateValidationGate({
        prepare: () => record(checkCalls, "prepare", passed),
        checks: () => record(checkCalls, "checks", blocked),
        acceptanceReview: () => record(checkCalls, "acceptance", passed),
        specialistReviews: () => record(checkCalls, "specialists", specialistsPassed),
      });
      expect(checkResult.outcome).toBe("blocked");
      expect(checkCalls).toEqual(["prepare", "checks"]);
    }),
  );

  it.effect("stops Specialists after blocking or failed Acceptance Review", () =>
    Effect.gen(function* () {
      const calls: string[] = [];

      const blockedResult = yield* runCandidateValidationGate({
        checks: () => record(calls, "checks", passed),
        acceptanceReview: () => record(calls, "acceptance", blocked),
        specialistReviews: () => record(calls, "specialists", specialistsPassed),
      });

      expect(blockedResult.outcome).toBe("blocked");
      expect(calls).toEqual(["checks", "acceptance"]);

      calls.length = 0;
      const failure = new ReviewerProcessToolingFailed({
        operationName: "run_reviewer_process",
        message: "Acceptance Review tooling failed.",
      });
      const failedResult = yield* runCandidateValidationGate({
        checks: () => record(calls, "checks", passed),
        acceptanceReview: () =>
          Effect.sync(() => {
            calls.push("acceptance");
            return { findings: 0 as const, toolingFailure: failure };
          }),
        specialistReviews: () => record(calls, "specialists", specialistsPassed),
      });

      expect(failedResult).toMatchObject({
        outcome: "tooling_failed",
        toolingFailures: [failure],
      });
      expect(calls).toEqual(["checks", "acceptance"]);

      const abandonmentResult = yield* runCandidateValidationGate({
        checks: () => Effect.succeed(passed),
        acceptanceReview: () =>
          Effect.succeed({
            findings: 0 as const,
            requiresAbandonment: true,
            toolingFailure: failure,
          }),
        specialistReviews: () => record(calls, "specialists", specialistsPassed),
      });
      expect(abandonmentResult).toMatchObject({
        outcome: "tooling_failed",
        requiresAbandonment: true,
        toolingFailures: [failure],
      });
      expect(calls).toEqual(["checks", "acceptance"]);
    }),
  );

  it.effect("translates final passing, blocking, and Tooling Failure results truthfully", () =>
    Effect.gen(function* () {
      const failure = new ReviewerProcessToolingFailed({
        operationName: "run_reviewer_process",
        message: "Specialist tooling failed.",
      });
      const run = (
        specialistResult:
          | typeof specialistsPassed
          | {
              readonly findings: 1;
              readonly reviewerEvidence: readonly [];
              readonly toolingFailures: readonly [] | readonly [ReviewerProcessToolingFailed];
            },
      ) =>
        runCandidateValidationGate({
          checks: () => Effect.succeed(passed),
          specialistReviews: () => Effect.succeed(specialistResult),
        });

      expect((yield* run(specialistsPassed)).outcome).toBe("passed");
      expect(
        (yield* run({
          findings: 1,
          reviewerEvidence: [],
          toolingFailures: [],
        })).outcome,
      ).toBe("blocked");
      const toolingResult = yield* run({
        findings: 1,
        reviewerEvidence: [],
        toolingFailures: [failure],
      });
      expect(toolingResult).toMatchObject({
        outcome: "tooling_failed",
        toolingFailures: [failure],
      });
    }),
  );
});
