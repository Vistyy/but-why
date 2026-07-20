import { describe, expect, it } from "vitest";

import type { TaskState } from "../src/task/lifecycle.js";
import { publicTaskId } from "../src/task/taskId.js";
import type { TaskStore } from "../src/task/taskStore.js";
import { taskStateTransitionPath } from "./support/taskLifecycle.js";
import { createTaskStore } from "./support/taskStore.js";

const firstNow = "2026-06-30T12:00:00.000Z";
const secondNow = "2026-06-30T12:05:00.000Z";
const thirdNow = "2026-06-30T12:10:00.000Z";
const closedStates = ["implementing", "validating", "ready", "done"] as const;

describe("Task command policy", () => {
  it.each(closedStates)("rejects approval in %s", (state) => {
    const tasks = taskInState(state);

    expect(tasks.approveTask({ taskId: publicTaskId("BY-1"), now: thirdNow })).toEqual({
      ok: false,
      code: "invalid_task_state",
      state,
    });
    expect(tasks.getTaskById(publicTaskId("BY-1"))?.updatedAt).toBe(secondNow);
  });

  it.each(closedStates)("rejects comments in %s without changing Task Context", (state) => {
    const tasks = taskInState(state);
    const before = tasks.getTaskContextById(publicTaskId("BY-1"));

    expect(
      tasks.appendTaskComment({
        taskId: publicTaskId("BY-1"),
        content: "Too late",
        now: () => thirdNow,
      }),
    ).toEqual({ ok: false, code: "invalid_task_state", state });
    expect(tasks.getTaskContextById(publicTaskId("BY-1"))).toEqual(before);
    expect(tasks.getTaskById(publicTaskId("BY-1"))?.updatedAt).toBe(secondNow);
  });
});

const taskInState = (state: TaskState): TaskStore => {
  const tasks = createTaskStore();

  tasks.createTask({
    title: "Policy Task",
    description: "Task policy behavior",
    now: firstNow,
  });

  for (const nextState of taskStateTransitionPath(state)) {
    const result = tasks.transitionTaskState({
      taskId: publicTaskId("BY-1"),
      to: nextState,
      now: secondNow,
    });
    if (!result.ok) throw new Error(result.code);
  }

  return tasks;
};
