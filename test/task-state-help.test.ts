import { describe, expect, it } from "vitest";

import { taskApprovalStateHelp } from "../src/cli/task/taskStateHelp.js";
import { publicTaskId } from "../src/task/taskId.js";

const taskId = publicTaskId("BY-1");

describe("Task state command guidance", () => {
  it.each([
    [
      "implementing",
      "Inspect the linked Change with by task show BY-1, then submit it with by change submit <change-id>.",
    ],
    ["validating", "Wait for validation to finish."],
    [
      "needs_input",
      "Address the Findings on the linked Change, then run by change submit <change-id>.",
    ],
    ["ready", "Review and merge the pull request."],
    ["done", "Task is already done."],
  ] as const)("guides approval rejected in %s", (state, help) => {
    expect(taskApprovalStateHelp(taskId, state)).toBe(help);
  });
});
