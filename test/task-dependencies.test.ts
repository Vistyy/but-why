import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { TaskDependencyValidationError } from "../src/task/task.js";
import { publicTaskId } from "../src/task/taskId.js";
import type { TaskStore } from "../src/task/taskStore.js";
import { runByInProcessEffect } from "./support/by-cli.js";
import { createTestWorkspace } from "./support/testWorkspace.js";
import { fakeTaskUseCases } from "./support/taskUseCases.js";
import { createTaskStore } from "./support/taskStore.js";

const firstNow = "2026-06-30T12:00:00.000Z";
const secondNow = "2026-06-30T12:05:00.000Z";

describe("Task dependency graph", () => {
  it.effect("parses repeated dependency options and creates the Task atomically", () =>
    Effect.gen(function* () {
      const root = createTestWorkspace();
      const descriptionPath = join(root, "Dependent.md");
      let receivedDependencies: readonly string[] = [];
      writeFileSync(descriptionPath, "Description for Dependent");

      const result = yield* runByInProcessEffect(
        root,
        [
          "task",
          "create",
          "--title",
          "Dependent",
          "--description-file",
          descriptionPath,
          "--depends-on",
          "BY-1",
          "--depends-on",
          "BY-2",
          "--output",
          "json",
        ],
        firstNow,
        {
          taskUseCases: fakeTaskUseCases({
            createTask: (input) => {
              receivedDependencies = input.dependsOn ?? [];
              return {
                id: "BY-3",
                title: input.title,
                state: "new",
                createdAt: input.now,
                updatedAt: input.now,
                startable: false,
                blockedBy: [],
              };
            },
          }),
        },
      );

      expect(result.status).toBe(0);
      expect(receivedDependencies).toEqual(["BY-1", "BY-2"]);

      const tasks = createTaskStore();
      createTask(tasks, "First");
      createTask(tasks, "Second");
      createTask(tasks, "Dependent", ["BY-1", "BY-2"]);

      expect(tasks.getTaskById(publicTaskId("BY-3"))?.prerequisites).toEqual([
        { id: "BY-1", title: "First", state: "new" },
        { id: "BY-2", title: "Second", state: "new" },
      ]);

      expect(() => createTask(tasks, "Invalid", ["BY-404"])).toThrow(TaskDependencyValidationError);
      expect(createTask(tasks, "Next").id).toBe("BY-4");
    }),
  );

  it.effect("routes dependency replacement and maps dependency errors through the CLI", () =>
    Effect.gen(function* () {
      const root = createTestWorkspace();
      let received: readonly string[] = [];
      const task = {
        id: "BY-3",
        title: "Dependent",
        description: "Description",
        state: "new" as const,
        createdAt: firstNow,
        updatedAt: firstNow,
        startable: false,
        blockedBy: [],
        branch: null,
        latestValidationRun: null,
        commentCount: 0,
        prerequisites: [
          { id: "BY-1", title: "First", state: "new" as const },
          { id: "BY-2", title: "Second", state: "new" as const },
        ],
        dependents: [],
      };
      const success = yield* runByInProcessEffect(
        root,
        [
          "task",
          "dependencies",
          "set",
          "BY-3",
          "--depends-on",
          "BY-1",
          "--depends-on",
          "BY-2",
          "--output",
          "json",
        ],
        firstNow,
        {
          taskUseCases: fakeTaskUseCases({
            replaceTaskDependencies: (_taskId, prerequisiteTaskIds) => {
              received = prerequisiteTaskIds;
              return { ok: true, task };
            },
          }),
        },
      );

      expect(success.status).toBe(0);
      expect(received).toEqual(["BY-1", "BY-2"]);
      expect(JSON.parse(success.stdout)).toEqual({
        task: { id: "BY-3", prerequisites: task.prerequisites },
      });

      const failure = yield* runByInProcessEffect(
        root,
        ["task", "dependencies", "set", "BY-3", "--depends-on", "BY-3"],
        firstNow,
        {
          taskUseCases: fakeTaskUseCases({
            replaceTaskDependencies: () => ({
              ok: false,
              code: "dependency_self",
              taskId: publicTaskId("BY-3"),
            }),
          }),
        },
      );

      expect(failure.status).toBe(1);
      expect(failure.stdout).toContain("code: dependency_self");
      expect(failure.stdout).toContain("Task BY-3 cannot depend on itself.");
    }),
  );

  it("replaces the complete direct dependency list and can clear it", () => {
    const tasks = setupDependencyGraph();

    const replaced = tasks.replaceTaskDependencies({
      taskId: publicTaskId("BY-3"),
      prerequisiteTaskIds: [publicTaskId("BY-2")],
    });

    expect(replaced).toMatchObject({
      ok: true,
      task: { prerequisites: [{ id: "BY-2", title: "Second", state: "new" }] },
    });
    expect(tasks.getTaskById(publicTaskId("BY-1"))?.dependents).toEqual([]);

    const cleared = tasks.replaceTaskDependencies({
      taskId: publicTaskId("BY-3"),
      prerequisiteTaskIds: [],
    });
    expect(cleared).toMatchObject({ ok: true, task: { prerequisites: [] } });
  });

  it.each([
    ["unknown prerequisite", ["BY-404"], "dependency_unknown_task"],
    ["self dependency", ["BY-3"], "dependency_self"],
    ["duplicate input", ["BY-1", "BY-1"], "dependency_duplicate"],
  ] as const)("rejects %s without changing the graph", (_name, dependencies, code) => {
    const tasks = setupDependencyGraph();

    const result = tasks.replaceTaskDependencies({
      taskId: publicTaskId("BY-3"),
      prerequisiteTaskIds: dependencies.map(publicTaskId),
    });

    expect(result).toMatchObject({ ok: false, code });
    expect(tasks.getTaskById(publicTaskId("BY-3"))?.prerequisites).toEqual([
      { id: "BY-1", title: "First", state: "new" },
    ]);
  });

  it("rejects cycles without changing the graph", () => {
    const tasks = createTaskStore();
    createTask(tasks, "First");
    createTask(tasks, "Second", ["BY-1"]);
    createTask(tasks, "Third", ["BY-2"]);

    const result = tasks.replaceTaskDependencies({
      taskId: publicTaskId("BY-1"),
      prerequisiteTaskIds: [publicTaskId("BY-3")],
    });

    expect(result).toMatchObject({ ok: false, code: "dependency_cycle" });
    expect(tasks.getTaskById(publicTaskId("BY-1"))?.prerequisites).toEqual([]);
  });

  it("returns direct graph facts and start eligibility with direct blockers", () => {
    const tasks = createTaskStore();
    createTask(tasks, "Done prerequisite");
    createTask(tasks, "Open prerequisite");
    createTask(tasks, "Dependent", ["BY-1", "BY-2"]);
    expect(tasks.approveTask({ taskId: publicTaskId("BY-1"), now: secondNow }).ok).toBe(true);
    expect(tasks.approveTask({ taskId: publicTaskId("BY-3"), now: secondNow }).ok).toBe(true);
    transitionToDone(tasks, "BY-1");

    expect(tasks.getTaskById(publicTaskId("BY-3"))?.prerequisites).toEqual([
      { id: "BY-1", title: "Done prerequisite", state: "done" },
      { id: "BY-2", title: "Open prerequisite", state: "new" },
    ]);
    expect(tasks.getTaskById(publicTaskId("BY-2"))?.dependents).toEqual([
      { id: "BY-3", title: "Dependent", state: "todo" },
    ]);

    const summaries = tasks.listTasks({ includeDone: true });
    expect(summaries.find((task) => task.id === "BY-3")).toMatchObject({
      startable: false,
      blockedBy: [{ id: "BY-2", title: "Open prerequisite", state: "new" }],
    });
    expect(summaries.find((task) => task.id === "BY-1")).toMatchObject({
      startable: false,
      blockedBy: [],
    });
  });
});

const setupDependencyGraph = (): TaskStore => {
  const tasks = createTaskStore();

  createTask(tasks, "First");
  createTask(tasks, "Second");
  createTask(tasks, "Dependent", ["BY-1"]);

  return tasks;
};

const createTask = (tasks: TaskStore, title: string, dependencies: readonly string[] = []) =>
  tasks.createTask({
    title,
    description: `Description for ${title}`,
    now: firstNow,
    dependsOn: dependencies.map(publicTaskId),
  });

const transitionToDone = (tasks: TaskStore, taskId: string): void => {
  for (const state of ["implementing", "validating", "ready", "done"] as const) {
    const result = tasks.transitionTaskState({
      taskId: publicTaskId(taskId),
      to: state,
      now: secondNow,
    });
    if (!result.ok) throw new Error(result.code);
  }
};
