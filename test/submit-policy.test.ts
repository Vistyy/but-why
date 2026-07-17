import { describe, expect, it } from "vitest";

import type { TaskState } from "../src/task/lifecycle.js";
import { submitStateReadiness } from "../src/task/submitPolicy.js";

describe("submit state policy", () => {
  it.each([
    ["new", false],
    ["todo", false],
    ["implementing", true],
    ["validating", false],
    ["needs_input", true],
    ["ready", false],
    ["done", false],
  ] as const)("reports whether %s Tasks can submit", (state, eligible) => {
    const result = submitStateReadiness(state satisfies TaskState);

    expect(result).toEqual(
      eligible
        ? { ok: true, previousTaskState: state }
        : { ok: false, code: "TASK_STATE_NOT_SUBMITTABLE", state },
    );
  });
});
