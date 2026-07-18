import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeReviewerOutputContract,
  validateReviewerArtifactRefs,
} from "../src/contracts/reviewerOutput.js";

describe("reviewer output contract", () => {
  it("accepts reviewer Findings with severity", async () => {
    const finding = reviewerFinding({
      files: ["src/cli.ts"],
      severity: "high",
      artifactRefs: ["artifact:by-1-09224d806043.v1/intent_review/intent/output.json"],
    });
    const output = await Effect.runPromise(
      decodeReviewerOutputContract({
        reviewer: "intent",
        attempts: 1,
        output: { findings: [finding] },
      }),
    );

    expect(output).toEqual({ findings: [finding] });
  });

  it("accepts Candidate-owned Validation Run artifact references", async () => {
    const artifactRef = "artifact:123e4567-e89b-42d3-a456-426614174000/checks/quality/stdout.txt";
    const finding = reviewerFinding({ severity: "low", artifactRefs: [artifactRef] });

    await expect(
      Effect.runPromise(
        decodeReviewerOutputContract({
          reviewer: "acceptance",
          attempts: 1,
          output: { findings: [finding] },
        }),
      ),
    ).resolves.toEqual({ findings: [finding] });
  });

  it("rejects artifact references that do not resolve within the Validation Run", async () => {
    const dangling = "artifact:123e4567-e89b-42d3-a456-426614174000/checks/quality/stdout.txt";
    const output = {
      findings: [
        {
          title: "Task intent is not satisfied",
          description: "The submitted code does not implement the requested behavior.",
          severity: "high" as const,
          evidence: "The changed command still returns the old output.",
          files: [],
          artifactRefs: [dangling],
        },
      ],
    };

    const error = await Effect.runPromise(
      Effect.flip(
        validateReviewerArtifactRefs({
          reviewer: "acceptance",
          attempts: 1,
          validationRunId: "123e4567-e89b-42d3-a456-426614174000",
          output,
          availableArtifactRefs: [],
        }),
      ),
    );

    expect(error).toMatchObject({
      _tag: "ReviewerOutputContractFailed",
      operationName: "resolve_reviewer_artifact_refs",
      diagnostics: [
        expect.objectContaining({
          path: ["findings", 0, "artifactRefs", 0],
          actual: dangling,
        }),
      ],
    });
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

  it.each([
    ["a missing findings field", {}, "findings"],
    ["unknown top-level fields", { findings: [], summary: "done" }, "summary"],
    [
      "unknown Finding fields",
      { findings: [reviewerFinding({ severity: "low", confidence: 1 })] },
      "findings.0.confidence",
    ],
    [
      "empty Finding text",
      { findings: [reviewerFinding({ severity: "low", title: " " })] },
      "findings.0.title",
    ],
    [
      "non-relative file paths",
      { findings: [reviewerFinding({ severity: "low", files: ["../src/cli.ts"] })] },
      "findings.0.files.0",
    ],
    [
      "malformed artifact refs",
      { findings: [reviewerFinding({ severity: "low", artifactRefs: ["logs.txt"] })] },
      "findings.0.artifactRefs.0",
    ],
  ])("rejects %s", async (_name, output, path) => {
    const error = await Effect.runPromise(
      Effect.flip(decodeReviewerOutputContract({ reviewer: "quality", attempts: 3, output })),
    );

    expect(error._tag).toBe("ReviewerOutputContractFailed");
    expect(error.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: path.split(".").map(pathPart) })]),
    );
    expect(error.message).toContain(path);
  });
});

const pathPart = (value: string): string | number =>
  /^\d+$/u.test(value) ? Number.parseInt(value, 10) : value;

const reviewerFinding = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  title: "Task intent is not satisfied",
  description: "The submitted code does not implement the requested behavior.",
  evidence: "The changed command still returns the old output.",
  files: [],
  artifactRefs: [],
  ...overrides,
});
