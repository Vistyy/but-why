import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { taskStates, canTransition, isTaskState, type TaskState } from "../src/task/lifecycle.js";
import { canSubmitFrom, type SubmitEligibleState } from "../src/task/submitPolicy.js";

describe("Task lifecycle", () => {
  it("owns the canonical Task state vocabulary and legal transitions", () => {
    expect(taskStates).toEqual([
      "new",
      "todo",
      "implementing",
      "validating",
      "needs_input",
      "ready",
      "done",
    ]);

    const expectedTransitions = new Map<TaskState, readonly TaskState[]>([
      ["new", ["todo"]],
      ["todo", ["implementing"]],
      ["implementing", ["validating"]],
      ["validating", ["implementing", "needs_input", "ready"]],
      ["needs_input", ["validating"]],
      ["ready", ["validating", "done", "needs_input"]],
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

  it("owns submit eligibility as a type guard", () => {
    const submitEligibleStates: SubmitEligibleState[] = taskStates.filter(canSubmitFrom);

    expect(submitEligibleStates).toEqual(["implementing", "needs_input"]);
  });

  it("keeps the durable Task state constraint in sync with Task states", () => {
    const stateDatabaseSource = readFileSync("src/init/stateDatabase.ts", "utf8");
    const matches = [...stateDatabaseSource.matchAll(/state IN \(([^)]+)\)/g)];
    const stateList = matches.map((match) => match[1]).find((states) => states?.includes("'new'"));

    if (stateList === undefined) {
      throw new Error("Task state SQL constraint was not found");
    }

    const durableStates = stateList.split(",").map((state) => state.trim().replaceAll("'", ""));

    expect(durableStates).toEqual([...taskStates]);
  });
});
