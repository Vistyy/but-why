import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decodeReviewerOutputContract } from "../src/validation/reviewerOutputContract.js";

describe("reviewer output contract", () => {
  it("accepts reviewer Findings with severity", async () => {
    const finding = reviewerFinding({ files: ["src/cli.ts"], severity: "high" });
    const output = await Effect.runPromise(
      decodeReviewerOutputContract({
        reviewer: "intent",
        attempts: 1,
        output: { findings: [finding] },
      }),
    );

    expect(output).toEqual({ findings: [finding] });
  });

  it.each([
    ["missing", undefined],
    ["invalid", "warning"],
  ])("rejects reviewer Findings with %s severity", async (_name, severity) => {
    const finding = reviewerFinding(severity === undefined ? {} : { severity });

    const error = await Effect.runPromise(
      Effect.flip(
        decodeReviewerOutputContract({
          reviewer: "intent",
          attempts: 2,
          output: { findings: [finding] },
        }),
      ),
    );

    expect(error._tag).toBe("ReviewerOutputContractFailed");
    expect(error.reviewer).toBe("intent");
    expect(error.attempts).toBe(2);
    expect(error.message).toContain("severity");
  });
});

const reviewerFinding = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  title: "Task intent is not satisfied",
  description: "The submitted code does not implement the requested behavior.",
  evidence: "The changed command still returns the old output.",
  files: [],
  artifactRefs: [],
  ...overrides,
});
