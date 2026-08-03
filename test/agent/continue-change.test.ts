import { describe, expect, it } from "vitest";

import {
  buildContinuationMessage,
  decideContinuation,
  extractChangeId,
  nextRetryState,
} from "../../extensions/continue-change.js";

describe("Change Implement continuation policy", () => {
  it("continues an unfinished Change with Findings instructions", () => {
    const decision = decideContinuation({
      change: { state: "open", closeReason: null },
      currentCandidate: null,
      currentValidationRun: null,
      findingCount: 2,
      toolingFailureCount: 0,
      pullRequest: null,
    });

    expect(decision).toEqual({ kind: "findings" });
    const message = buildContinuationMessage(decision, "change-123");
    expect(message).toContain("Inspect the Findings");
    expect(message).toContain("fix every applicable problem");
    expect(message).toContain("commit the fixes");
    expect(message).toContain("submit again");
  });

  it.each([
    ["closed Change", { change: { state: "closed", closeReason: "completed" } } as const],
    ["blocked Change", { change: { state: "blocked", closeReason: null } } as const],
    [
      "tooling failure",
      { change: { state: "open", closeReason: null }, toolingFailureCount: 1 } as const,
    ],
  ])("permits idle state for a %s", (_name, input) => {
    expect(
      decideContinuation({
        currentCandidate: null,
        currentValidationRun: null,
        findingCount: 0,
        toolingFailureCount: 0,
        pullRequest: null,
        ...input,
      }),
    ).toEqual({ kind: "idle" });
  });

  it("permits idle state for a blocked Change even when Findings exist", () => {
    expect(
      decideContinuation({
        change: { state: "blocked", closeReason: null },
        currentCandidate: null,
        currentValidationRun: null,
        findingCount: 1,
        toolingFailureCount: 0,
        pullRequest: null,
      }),
    ).toEqual({ kind: "idle" });
  });

  it("permits idle state for an owned pull request matching the current Candidate and Git head", () => {
    expect(
      decideContinuation(
        {
          change: { state: "open", closeReason: null },
          currentCandidate: { id: "candidate-1", headSha: "head-1" },
          currentValidationRun: null,
          findingCount: 0,
          toolingFailureCount: 0,
          pullRequest: { number: 4 },
          publication: {
            candidateId: "candidate-1",
            expectedHeadSha: "head-1",
            pullRequest: { number: 4 },
          },
        },
        { head: "head-1", status: "" },
      ),
    ).toEqual({ kind: "idle" });
  });

  it("continues when a pull request does not match the current Git head", () => {
    expect(
      decideContinuation(
        {
          change: { state: "open", closeReason: null },
          currentCandidate: { id: "candidate-1", headSha: "old-head" },
          currentValidationRun: null,
          findingCount: 0,
          toolingFailureCount: 0,
          pullRequest: { number: 4 },
          publication: {
            candidateId: "candidate-1",
            expectedHeadSha: "old-head",
            pullRequest: { number: 4 },
          },
        },
        { head: "new-head", status: "" },
      ),
    ).toEqual({ kind: "general" });
  });

  it("continues a Change against its complete accepted intent", () => {
    const decision = decideContinuation({
      change: { state: "open", closeReason: null },
      currentCandidate: null,
      currentValidationRun: null,
      findingCount: 0,
      toolingFailureCount: 0,
      pullRequest: null,
    });

    const message = buildContinuationMessage(decision, "change-123");
    expect(message).toContain("Resume implementation of Change change-123");
    expect(message).toContain("linked Task Context when present");
    expect(message).toContain("complete accepted intent");
    expect(message).toContain("until Change Submit passes");
  });

  it("extracts the Change identity from the user handoff", () => {
    expect(extractChangeId("Change identity: de32d32a-ecd8-46b4-b2d8-5a08d2128869.")).toBe(
      "de32d32a-ecd8-46b4-b2d8-5a08d2128869",
    );
    expect(extractChangeId("The assistant said Change identity: not-a-change.")).toBeUndefined();
  });

  it("resets the unchanged restart count when the durable fingerprint changes", () => {
    expect(nextRetryState({ fingerprint: "old", unchangedRestarts: 2 }, "new")).toEqual({
      fingerprint: "new",
      unchangedRestarts: 0,
    });
    expect(nextRetryState({ fingerprint: "same", unchangedRestarts: 2 }, "same")).toEqual({
      fingerprint: "same",
      unchangedRestarts: 3,
    });
  });
});
