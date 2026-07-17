import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadTaskUseCases } from "../src/localTask/taskUseCases.js";
import { publicTaskId } from "../src/task/taskId.js";
import {
  cleanupTempRoots,
  commitButWhyConfigAndRecordDefault,
  createGitRepo,
  runByInProcess,
} from "./support/by-cli.js";

const firstNow = "2026-06-30T12:00:00.000Z";
const secondNow = "2026-06-30T12:05:00.000Z";

afterEach(cleanupTempRoots);

describe("Task dependency graph", () => {
  it("creates a Task with repeated dependency options atomically", () => {
    const root = initializedRepo();
    createTask(root, "First");
    createTask(root, "Second");

    const result = createTask(root, "Dependent", ["BY-1", "BY-2"]);

    expect(result.status).toBe(0);
    expect(JSON.parse(show(root, "BY-3").stdout).task.prerequisites).toEqual([
      { id: "BY-1", title: "First", state: "new" },
      { id: "BY-2", title: "Second", state: "new" },
    ]);

    const failed = createTask(root, "Invalid", ["BY-404"]);
    expect(failed.status).toBe(1);
    expect(JSON.parse(failed.stdout).error.code).toBe("dependency_unknown_task");

    const next = createTask(root, "Next");
    expect(JSON.parse(next.stdout).task.id).toBe("BY-4");
  });

  it("replaces the complete direct dependency list and can clear it", () => {
    const root = initializedRepo();
    createTask(root, "First");
    createTask(root, "Second");
    createTask(root, "Dependent", ["BY-1"]);

    const replaced = runByInProcess(root, [
      "task",
      "dependencies",
      "set",
      "BY-3",
      "--depends-on",
      "BY-2",
      "--output",
      "json",
    ]);

    expect(replaced.status).toBe(0);
    expect(JSON.parse(replaced.stdout).task.prerequisites).toEqual([
      { id: "BY-2", title: "Second", state: "new" },
    ]);
    expect(JSON.parse(show(root, "BY-1").stdout).task.dependents).toEqual([]);

    const cleared = runByInProcess(root, [
      "task",
      "dependencies",
      "set",
      "BY-3",
      "--output",
      "json",
    ]);
    expect(cleared.status).toBe(0);
    expect(JSON.parse(cleared.stdout).task.prerequisites).toEqual([]);
  });

  it.each([
    ["unknown prerequisite", ["BY-404"], "dependency_unknown_task"],
    ["self dependency", ["BY-3"], "dependency_self"],
    ["duplicate input", ["BY-1", "BY-1"], "dependency_duplicate"],
  ] as const)("rejects %s without changing the graph", (_name, dependencies, code) => {
    const root = initializedRepo();
    createTask(root, "First");
    createTask(root, "Second");
    createTask(root, "Dependent", ["BY-1"]);

    const result = setDependencies(root, "BY-3", dependencies);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe(code);
    expect(JSON.parse(show(root, "BY-3").stdout).task.prerequisites).toEqual([
      { id: "BY-1", title: "First", state: "new" },
    ]);
  });

  it("rejects cycles without changing the graph", () => {
    const root = initializedRepo();
    createTask(root, "First");
    createTask(root, "Second", ["BY-1"]);
    createTask(root, "Third", ["BY-2"]);

    const result = setDependencies(root, "BY-1", ["BY-3"]);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe("dependency_cycle");
    expect(JSON.parse(show(root, "BY-1").stdout).task.prerequisites).toEqual([]);
  });

  it("blocks Start until every direct prerequisite is done and locks dependencies after Start", () => {
    const root = initializedRepo();
    createTask(root, "Prerequisite");
    createTask(root, "Dependent", ["BY-1"]);
    approve(root, "BY-1");
    approve(root, "BY-2");

    const blocked = runByInProcess(root, ["task", "start", "BY-2", "--output", "json"]);
    expect(blocked.status).toBe(1);
    expect(JSON.parse(blocked.stdout).error).toMatchObject({
      code: "task_dependencies_unsatisfied",
      taskId: "BY-2",
      blockedBy: [{ id: "BY-1", title: "Prerequisite", state: "todo" }],
    });

    transitionToDone(root, "BY-1");
    expect(runByInProcess(root, ["task", "start", "BY-2"]).status).toBe(0);

    const locked = setDependencies(root, "BY-2", []);
    expect(locked.status).toBe(1);
    expect(JSON.parse(locked.stdout).error.code).toBe("dependencies_locked");
    expect(JSON.parse(show(root, "BY-2").stdout).task.prerequisites).toEqual([
      { id: "BY-1", title: "Prerequisite", state: "done" },
    ]);
  });

  it("shows direct graph facts and lists start eligibility with direct blockers", () => {
    const root = initializedRepo();
    createTask(root, "Done prerequisite");
    createTask(root, "Open prerequisite");
    createTask(root, "Dependent", ["BY-1", "BY-2"]);
    approve(root, "BY-1");
    approve(root, "BY-3");
    transitionToDone(root, "BY-1");

    const shown = JSON.parse(show(root, "BY-3").stdout).task;
    expect(shown.prerequisites).toEqual([
      { id: "BY-1", title: "Done prerequisite", state: "done" },
      { id: "BY-2", title: "Open prerequisite", state: "new" },
    ]);
    expect(JSON.parse(show(root, "BY-2").stdout).task.dependents).toEqual([
      { id: "BY-3", title: "Dependent", state: "todo" },
    ]);

    const tasks = JSON.parse(
      runByInProcess(root, ["task", "list", "--all", "--output", "json"]).stdout,
    ).tasks;
    expect(tasks.find((task: { id: string }) => task.id === "BY-3")).toMatchObject({
      startable: false,
      blockedBy: [{ id: "BY-2", title: "Open prerequisite", state: "new" }],
    });
    expect(tasks.find((task: { id: string }) => task.id === "BY-1")).toMatchObject({
      startable: false,
      blockedBy: [],
    });
  });
});

const initializedRepo = (): string => {
  const root = createGitRepo();
  expect(runByInProcess(root, ["init", "--task-prefix", "BY"]).status).toBe(0);
  commitButWhyConfigAndRecordDefault(root);
  return root;
};

const createTask = (root: string, title: string, dependencies: readonly string[] = []) => {
  const descriptionPath = join(root, `${title}.md`);
  writeFileSync(descriptionPath, `Description for ${title}`);
  return runByInProcess(root, [
    "task",
    "create",
    "--title",
    title,
    "--description-file",
    descriptionPath,
    ...dependencies.flatMap((dependency) => ["--depends-on", dependency]),
    "--output",
    "json",
  ]);
};

const show = (root: string, taskId: string) =>
  runByInProcess(root, ["task", "show", taskId, "--output", "json"]);

const setDependencies = (root: string, taskId: string, dependencies: readonly string[]) =>
  runByInProcess(root, [
    "task",
    "dependencies",
    "set",
    taskId,
    ...dependencies.flatMap((dependency) => ["--depends-on", dependency]),
    "--output",
    "json",
  ]);

const approve = (root: string, taskId: string): void => {
  expect(runByInProcess(root, ["task", "approve", taskId], secondNow).status).toBe(0);
};

const transitionToDone = (root: string, taskId: string): void => {
  const loaded = loadTaskUseCases({
    cwd: root,
    requireState: true,
    migrationTimestamp: () => firstNow,
  });
  if (!loaded.ok) throw new Error(loaded.error.code);

  for (const state of ["implementing", "validating", "ready", "done"] as const) {
    const result = loaded.tasks.transitionTaskState({
      taskId: publicTaskId(taskId),
      to: state,
      now: secondNow,
    });
    if (!result.ok) throw new Error(result.code);
  }
};
