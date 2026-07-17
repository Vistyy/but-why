import { describe, expect, it } from "vitest";

import { taskApprovalStateHelp, taskStartStateHelpFor } from "../src/cli/task/taskStateHelp.js";
import { publicTaskId } from "../src/task/taskId.js";

const taskId = publicTaskId("BY-1");

describe("Task state command guidance", () => {
  it.each([
    ["implementing", "Continue implementation, then run by submit BY-1."],
    ["validating", "Wait for validation to finish."],
    ["needs_input", "Address the Findings, then run by submit BY-1."],
    ["ready", "Review and merge the pull request."],
    ["done", "Task is already done."],
  ] as const)("guides approval rejected in %s", (state, help) => {
    expect(taskApprovalStateHelp(taskId, state)).toBe(help);
  });

  it.each([
    ["new", "Approve the Task first with by task approve BY-1."],
    ["todo", "Run the Task Start command again."],
    ["implementing", "Use the existing Task Start binding or inspect the Task state."],
    ["validating", "Wait for validation to finish."],
    ["needs_input", "Address findings or add Task Context, then run by submit BY-1."],
    ["ready", "Review and merge the pull request."],
    ["done", "Task is already done."],
  ] as const)("guides Task Start rejected in %s", (state, help) => {
    expect(taskStartStateHelpFor(taskId, state)).toBe(help);
  });
});
