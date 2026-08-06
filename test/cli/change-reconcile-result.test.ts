import { describe, expect, it } from "@effect/vitest";

import { reconcileResult } from "../../src/cli/change/reconcileResult.js";

describe("Change reconcile result mapping", () => {
  it("maps a rejected open-Change targeted discard to discard_open_change", () => {
    const result = reconcileResult(
      "change-open",
      {
        rejected: true,
        changes: [
          {
            changeId: "change-open",
            status: "rejected",
            rejection: "discard_open_change",
          },
        ],
      },
      true,
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(JSON.stringify(result.stdout))).toEqual({
      error: {
        code: "discard_open_change",
        message: "Work discard requires one exact terminal Change.",
        changes: [
          {
            changeId: "change-open",
            status: "rejected",
            rejection: "discard_open_change",
          },
        ],
      },
      help: [
        "Complete or cancel the Change first, then retry `by change reconcile <change-id> --discard-work`.",
      ],
    });
  });
});
