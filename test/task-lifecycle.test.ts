import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { taskStates, canTransition, isTaskState, type TaskState } from "../src/task/lifecycle.js";
import { canStartFrom } from "../src/task/startPolicy.js";
import { canSubmitFrom, type SubmitEligibleState } from "../src/task/submitPolicy.js";

describe("Task lifecycle", () => {
  it("owns the canonical Task state vocabulary and legal transitions", () => {
    expect(taskStates).toEqual([
      "todo",
      "implementing",
      "validating",
      "needs_input",
      "ready",
      "done",
    ]);

    const expectedTransitions = new Map<TaskState, readonly TaskState[]>([
      ["todo", ["implementing"]],
      ["implementing", ["validating"]],
      ["validating", ["needs_input", "ready"]],
      ["needs_input", ["validating"]],
      ["ready", ["done", "needs_input"]],
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
    expect(isTaskState("todo")).toBe(true);
    expect(isTaskState("unknown")).toBe(false);
  });

  it("keeps command no-ops out of lifecycle transitions", () => {
    expect(canStartFrom("implementing")).toBe(true);
    expect(canTransition("implementing", "implementing")).toBe(false);
  });

  it("owns submit eligibility as a type guard", () => {
    const submitEligibleStates: SubmitEligibleState[] = taskStates.filter(canSubmitFrom);

    expect(submitEligibleStates).toEqual(["implementing", "needs_input"]);
  });

  it("owns start eligibility policy", () => {
    const startEligibleStates = taskStates.filter(canStartFrom);

    expect(startEligibleStates).toEqual(["todo", "implementing"]);
  });

  it("keeps the durable Task state constraint in sync with Task states", () => {
    const stateDatabaseSource = readFileSync("src/init/stateDatabase.ts", "utf8");
    const match = stateDatabaseSource.match(/state IN \(([^)]+)\)/);

    if (match === null) {
      throw new Error("Task state SQL constraint was not found");
    }

    const stateList = match[1];

    if (stateList === undefined) {
      throw new Error("Task state SQL constraint did not include any states");
    }

    const durableStates = stateList.split(",").map((state) => state.trim().replaceAll("'", ""));

    expect(durableStates).toEqual([...taskStates]);
  });
});
