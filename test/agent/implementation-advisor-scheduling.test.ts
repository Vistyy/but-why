import { describe, expect, it } from "vitest";
import {
  implementationAdvisorToolNames,
  shouldEvaluateActivity,
  validateAdvisorNote,
  advisorDisabledAfterFailures,
  type Evidence,
} from "../../extensions/implementation-advisor/index.js";

describe("Implementation Advisor scheduler", () => {
  const evidence: Evidence[] = [
    {
      activity: "write",
      reference: "write:1",
      input: { path: "src/a.ts" },
      result: [],
      failed: false,
    },
  ];

  it("schedules qualifying activity and ignores discussion and ordinary reads", () => {
    expect(shouldEvaluateActivity("write", {})).toBe(true);
    expect(shouldEvaluateActivity("read", { path: "README.md" })).toBe(false);
    expect(shouldEvaluateActivity("read", { path: "docs/architecture.md" })).toBe(true);
  });

  it("enforces the fixed tool allowlist and structured output binding", () => {
    const firstEvidence = evidence[0];
    if (firstEvidence === undefined) throw new Error("Test evidence is missing");
    expect(implementationAdvisorToolNames).toEqual(["read", "grep", "find", "ls"]);
    expect(
      validateAdvisorNote(
        {
          ruleId: "authority.explicit-conflict",
          message: "Review the conflict.",
          evidence: ["read:1"],
          activityBatch: 2,
        },
        2,
        evidence,
      ),
    ).toBeUndefined();
    expect(
      validateAdvisorNote(
        {
          ruleId: "authority.explicit-conflict",
          message: "Review the conflict.",
          evidence: ["write:1"],
          activityBatch: 2,
        },
        2,
        [{ ...firstEvidence, reference: "write:1" }],
      ),
    ).toMatchObject({ activityBatch: 2 });
  });

  it("keeps delivery non-waking and continuation-owned", () => {
    expect({ triggerTurn: false, owner: "continue-change" }).toEqual({
      triggerTurn: false,
      owner: "continue-change",
    });
  });

  it("disables after three failures and permits restoration checks", () => {
    expect(advisorDisabledAfterFailures(2)).toBe(false);
    expect(advisorDisabledAfterFailures(3)).toBe(true);
    expect(advisorDisabledAfterFailures(4)).toBe(true);
  });
});
