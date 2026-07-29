import { describe, expect, it } from "vitest";

import {
  buildContinuationMessage,
  decideContinuation,
  extractChangeId,
  nextRetryState,
} from "../../src/agent/continueChange.js";

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
      "passing owned pull request",
      { change: { state: "open", closeReason: null }, pullRequest: { number: 4 } } as const,
    ],
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

  it("continues after automatic threshold compaction with a recovery message", () => {
    const decision = decideContinuation({
      change: { state: "open", closeReason: null },
      currentCandidate: null,
      currentValidationRun: null,
      findingCount: 0,
      toolingFailureCount: 0,
      pullRequest: null,
    });

    expect(buildContinuationMessage(decision, "change-123", "threshold")).toContain(
      "Restore the current Change state from the compacted context",
    );
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
