import { describe, expect, it } from "vitest";

import { taskApprovalStateHelp } from "../../src/cli/task/taskStateHelp.js";
import { publicTaskId } from "../../src/task/taskId.js";

const taskId = publicTaskId("BY-1");

describe("Task state command guidance", () => {
  it.each([
    ["done", "Task is already done."],
    ["cancelled", "Task is already cancelled."],
  ] as const)("guides approval rejected in %s", (state, help) => {
    expect(taskApprovalStateHelp(taskId, state)).toBe(help);
  });

  it("guides approval from an unexpected state to Task inspection", () => {
    expect(taskApprovalStateHelp(taskId, "new")).toBe("Inspect Task BY-1 with by task show BY-1.");
  });
});
