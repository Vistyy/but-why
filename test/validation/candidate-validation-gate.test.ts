import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { runCandidateValidationGate } from "../../src/change/candidateValidation/runCandidateValidationGate.js";
import { SandcastleToolingFailed } from "../../src/change/validation/validationToolingFailures.js";

const passed = { findings: 0 as const };
const blocked = { findings: 1 as const };
const specialistsPassed = {
  findings: 0 as const,
  reviewerEvidence: [],
  toolingFailures: [],
};

describe("Candidate Validation Gate", () => {
  it.effect("omits Acceptance Review for a taskless Candidate", () =>
    Effect.gen(function* () {
      const calls: string[] = [];

      const result = yield* runCandidateValidationGate({
        checks: () => Effect.sync(() => (calls.push("checks"), passed)),
        specialistReviews: () => Effect.sync(() => (calls.push("specialists"), specialistsPassed)),
      });

      expect(result).toEqual({ outcome: "passed", toolingFailures: [] });
      expect(calls).toEqual(["checks", "specialists"]);
    }),
  );

  it.effect("stops after blocking Repository Preparation or Checks", () =>
    Effect.gen(function* () {
      const prepareCalls: string[] = [];
      const prepareResult = yield* runCandidateValidationGate({
        prepare: () => Effect.sync(() => (prepareCalls.push("prepare"), blocked)),
        checks: () => Effect.sync(() => (prepareCalls.push("checks"), passed)),
        acceptanceReview: () => Effect.sync(() => (prepareCalls.push("acceptance"), passed)),
        specialistReviews: () =>
          Effect.sync(() => (prepareCalls.push("specialists"), specialistsPassed)),
      });
      expect(prepareResult.outcome).toBe("blocked");
      expect(prepareCalls).toEqual(["prepare"]);

      const checkCalls: string[] = [];
      const checkResult = yield* runCandidateValidationGate({
        prepare: () => Effect.sync(() => (checkCalls.push("prepare"), passed)),
        checks: () => Effect.sync(() => (checkCalls.push("checks"), blocked)),
        acceptanceReview: () => Effect.sync(() => (checkCalls.push("acceptance"), passed)),
        specialistReviews: () =>
          Effect.sync(() => (checkCalls.push("specialists"), specialistsPassed)),
      });
      expect(checkResult.outcome).toBe("blocked");
      expect(checkCalls).toEqual(["prepare", "checks"]);
    }),
  );

  it.effect("stops Specialists after blocking or failed Acceptance Review", () =>
    Effect.gen(function* () {
      const calls: string[] = [];

      const blockedResult = yield* runCandidateValidationGate({
        checks: () => Effect.sync(() => (calls.push("checks"), passed)),
        acceptanceReview: () => Effect.sync(() => (calls.push("acceptance"), blocked)),
        specialistReviews: () => Effect.sync(() => (calls.push("specialists"), specialistsPassed)),
      });

      expect(blockedResult.outcome).toBe("blocked");
      expect(calls).toEqual(["checks", "acceptance"]);

      calls.length = 0;
      const failure = new SandcastleToolingFailed({
        operationName: "run_reviewer_agent",
        message: "Acceptance Review tooling failed.",
      });
      const failedResult = yield* runCandidateValidationGate({
        checks: () => Effect.sync(() => (calls.push("checks"), passed)),
        acceptanceReview: () =>
          Effect.sync(() => {
            calls.push("acceptance");
            return { findings: 0 as const, toolingFailure: failure };
          }),
        specialistReviews: () => Effect.sync(() => (calls.push("specialists"), specialistsPassed)),
      });

      expect(failedResult).toMatchObject({
        outcome: "tooling_failed",
        toolingFailures: [failure],
      });
      expect(calls).toEqual(["checks", "acceptance"]);
    }),
  );

  it.effect("translates final passing, blocking, and Tooling Failure results truthfully", () =>
    Effect.gen(function* () {
      const failure = new SandcastleToolingFailed({
        operationName: "run_reviewer_agent",
        message: "Specialist tooling failed.",
      });
      const run = (
        specialistResult:
          | typeof specialistsPassed
          | {
              readonly findings: 1;
              readonly reviewerEvidence: readonly [];
              readonly toolingFailures: readonly [] | readonly [SandcastleToolingFailed];
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
