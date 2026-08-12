import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";
import { decodeTaskReviewerOutput } from "../../src/task/review/taskReviewerOutput.js";

const finding = {
  title: "Intent gap",
  description: "The proposal omits a required outcome.",
  evidence: "The proposal does not state the required result.",
  files: ["docs/spec.md"],
};

describe("Task Reviewer output contract", () => {
  it.effect("accepts exactly the shared core Finding fields", () =>
    Effect.gen(function* () {
      const output = yield* decodeTaskReviewerOutput({
        attempts: 1,
        output: { findings: [finding] },
      });

      expect(output).toEqual({ findings: [finding] });
    }),
  );

  for (const [name, output, path] of [
    [
      "Artifact references",
      { findings: [{ ...finding, artifactRefs: [] }] },
      "findings.0.artifactRefs",
    ],
    [
      "unknown Finding fields",
      { findings: [{ ...finding, confidence: 1 }] },
      "findings.0.confidence",
    ],
    ["unknown top-level fields", { findings: [], summary: "done" }, "summary"],
    [
      "a missing core field",
      { findings: [{ ...finding, evidence: undefined }] },
      "findings.0.evidence",
    ],
  ] as const) {
    it.effect(`rejects ${name}`, () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(decodeTaskReviewerOutput({ attempts: 2, output }));

        expect(error).toMatchObject({
          _tag: "TaskReviewerOutputContractFailed",
          operationName: "decode_task_reviewer_output",
          reviewer: "task",
          attempts: 2,
          diagnostics: expect.arrayContaining([
            expect.objectContaining({ path: path.split(".").map(pathPart) }),
          ]),
        });
      }),
    );
  }
});

const pathPart = (value: string): string | number =>
  /^\d+$/u.test(value) ? Number.parseInt(value, 10) : value;
