import { describe, expect, it } from "vitest";

import { taskStates, canTransition, isTaskState, type TaskState } from "../src/task/lifecycle.js";

describe("Task lifecycle", () => {
  it("owns the canonical Task state vocabulary and legal transitions", () => {
    expect(taskStates).toEqual(["new", "todo", "implementing", "validating", "ready", "done"]);

    const expectedTransitions = new Map<TaskState, readonly TaskState[]>([
      ["new", ["todo"]],
      ["todo", ["implementing"]],
      ["implementing", ["validating"]],
      ["validating", ["implementing", "ready"]],
      ["ready", ["validating", "done"]],
      ["done", []],
    ]);

    for (const from of taskStates) {
      for (const to of taskStates) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(
          expectedTransitions.get(from)?.includes(to) ?? false,
        );
      }
    }
  });

  it("recognizes Task states at boundaries", () => {
    expect(isTaskState("new")).toBe(true);
    expect(isTaskState("todo")).toBe(true);
    expect(isTaskState("unknown")).toBe(false);
  });
});
