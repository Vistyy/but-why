import { describe, expect, it } from "vitest";

import { taskStates, isTaskState } from "../../src/task/lifecycle.js";

describe("Task lifecycle", () => {
  it("owns the canonical four-state Task vocabulary", () => {
    expect(taskStates).toEqual(["new", "todo", "done", "cancelled"]);
  });

  it("recognizes Task states at boundaries", () => {
    expect(isTaskState("new")).toBe(true);
    expect(isTaskState("todo")).toBe(true);
    expect(isTaskState("done")).toBe(true);
    expect(isTaskState("cancelled")).toBe(true);
    expect(isTaskState("implementing")).toBe(false);
    expect(isTaskState("blocked")).toBe(false);
    expect(isTaskState("validating")).toBe(false);
    expect(isTaskState("ready")).toBe(false);
    expect(isTaskState("unknown")).toBe(false);
  });
});
