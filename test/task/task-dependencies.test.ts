import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import type { TaskUseCases } from "../../src/task/taskUseCases.js";
import { runByInProcessEffect } from "../support/by-cli.js";
import { createInitializedRepo } from "../support/initializedRepo.js";
import { fakeTaskUseCases } from "../support/taskUseCases.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const now = "2026-06-30T12:00:00.000Z";

type TaskGraph = {
  readonly prerequisites: readonly unknown[];
  readonly dependents: readonly unknown[];
};

const createTask = (root: string, title: string, dependencies: readonly string[] = []) =>
  Effect.gen(function* () {
    const descriptionFile = `${title.toLowerCase()}.md`;
    writeFileSync(join(root, descriptionFile), `Description for ${title}`);
    const result = yield* runByInProcessEffect(
      root,
      [
        "task",
        "create",
        "--title",
        title,
        "--description-file",
        descriptionFile,
        ...dependencies.flatMap((dependency) => ["--depends-on", dependency]),
        "--output",
        "json",
      ],
      now,
    );
    expect(result.status).toBe(0);
  });

const readGraph = (root: string, taskIds: readonly string[]) =>
  Effect.gen(function* () {
    const graph: Record<string, TaskGraph> = {};
    for (const taskId of taskIds) {
      const result = yield* runByInProcessEffect(
        root,
        ["task", "show", taskId, "--output", "json"],
        now,
      );
      graph[taskId] = (JSON.parse(result.stdout) as { readonly task: TaskGraph }).task;
    }
    return graph;
  });

const readTaskIds = (root: string) =>
  Effect.gen(function* () {
    const result = yield* runByInProcessEffect(
      root,
      ["task", "list", "--all", "--output", "json"],
      now,
    );
    return (
      JSON.parse(result.stdout) as { readonly tasks: readonly { readonly id: string }[] }
    ).tasks.map((task) => task.id);
  });

const expectJsonError = (
  result: { readonly status: number; readonly stderr: string; readonly stdout: string },
  expected: { readonly error: Record<string, unknown>; readonly help: readonly string[] },
) => {
  expect(result.status).toBe(1);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual(expected);
};

const dependencyErrorTaskUseCases = (overrides: Partial<TaskUseCases>): TaskUseCases => ({
  ...fakeTaskUseCases(),
  ...overrides,
});

describe("Task dependency CLI", () => {
  it.effect("passes repeated dependency options through the in-process CLI", () =>
    Effect.gen(function* () {
      const root = createTestWorkspace();
      const descriptionPath = join(root, "dependent.md");
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
        now,
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

      let replacementDependencies: readonly string[] = [];
      const replacement = yield* runByInProcessEffect(
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
        now,
        {
          taskUseCases: fakeTaskUseCases({
            replaceTaskDependencies: (_taskId, prerequisiteTaskIds) => {
              replacementDependencies = prerequisiteTaskIds;
              return {
                ok: true,
                task: {
                  id: "BY-3",
                  title: "Dependent",
                  description: "Description",
                  state: "new",
                  createdAt: now,
                  updatedAt: now,
                  startable: false,
                  blockedBy: [],
                  commentCount: 0,
                  prerequisites: [
                    { id: "BY-1", title: "First", state: "new" },
                    { id: "BY-2", title: "Second", state: "new" },
                  ],
                  dependents: [],
                },
              };
            },
          }),
        },
      );
      expect(replacement.status).toBe(0);
      expect(replacementDependencies).toEqual(["BY-1", "BY-2"]);
      expect(JSON.parse(replacement.stdout)).toEqual({
        task: {
          id: "BY-3",
          prerequisites: [
            { id: "BY-1", title: "First", state: "new" },
            { id: "BY-2", title: "Second", state: "new" },
          ],
        },
      });
    }),
  );

  it.effect("maps the defensive create-time dependency cycle result", () =>
    Effect.gen(function* () {
      const root = createTestWorkspace();
      writeFileSync(join(root, "cycle.md"), "Description for Cycle");
      const result = yield* runByInProcessEffect(
        root,
        [
          "task",
          "create",
          "--title",
          "Cycle",
          "--description-file",
          "cycle.md",
          "--depends-on",
          "BY-1",
          "--output",
          "json",
        ],
        now,
        {
          taskUseCases: dependencyErrorTaskUseCases({
            createTask: () => Effect.succeed({ ok: false, code: "dependency_cycle" }),
          }),
        },
      );

      expectJsonError(result, {
        error: { code: "dependency_cycle", message: "Task dependencies must not contain a cycle." },
        help: ["Use existing Tasks from `by task list --all` as direct prerequisites."],
      });
    }),
  );

  it.effect("reports reachable dependency rejections without changing the graph", () =>
    Effect.gen(function* () {
      const root = createInitializedRepo();
      yield* createTask(root, "First");
      yield* createTask(root, "Second", ["BY-1"]);
      yield* createTask(root, "Third", ["BY-2"]);
      const taskIds = ["BY-1", "BY-2", "BY-3"];
      const before = yield* readGraph(root, taskIds);

      for (const testCase of [
        {
          title: "Unknown",
          dependencies: ["BY-404"],
          error: {
            code: "dependency_unknown_task",
            message: "Dependency Task was not found: BY-404",
            taskId: "BY-404",
          },
        },
        {
          title: "Self",
          dependencies: ["BY-4"],
          error: {
            code: "dependency_self",
            message: "A Task cannot depend on itself.",
            taskId: "BY-4",
          },
        },
        {
          title: "Duplicate",
          dependencies: ["BY-1", "BY-1"],
          error: {
            code: "dependency_duplicate",
            message: "Dependency was provided more than once: BY-1",
            taskId: "BY-1",
          },
        },
      ] as const) {
        const descriptionFile = `${testCase.title.toLowerCase()}-rejection.md`;
        writeFileSync(join(root, descriptionFile), `Description for ${testCase.title}`);
        const result = yield* runByInProcessEffect(
          root,
          [
            "task",
            "create",
            "--title",
            testCase.title,
            "--description-file",
            descriptionFile,
            ...testCase.dependencies.flatMap((dependency) => ["--depends-on", dependency]),
            "--output",
            "json",
          ],
          now,
        );
        expectJsonError(result, {
          error: testCase.error,
          help: ["Use existing Tasks from `by task list --all` as direct prerequisites."],
        });
      }

      for (const testCase of [
        {
          taskId: "BY-3",
          dependencies: ["BY-404"],
          error: {
            code: "dependency_unknown_task",
            message: "Dependency Task was not found: BY-404",
            taskId: "BY-3",
            dependencyTaskId: "BY-404",
          },
        },
        {
          taskId: "BY-3",
          dependencies: ["BY-3"],
          error: {
            code: "dependency_self",
            message: "Task BY-3 cannot depend on itself.",
            taskId: "BY-3",
            dependencyTaskId: "BY-3",
          },
        },
        {
          taskId: "BY-3",
          dependencies: ["BY-2", "BY-2"],
          error: {
            code: "dependency_duplicate",
            message: "Dependency was provided more than once: BY-2",
            taskId: "BY-3",
            dependencyTaskId: "BY-2",
          },
        },
        {
          taskId: "BY-1",
          dependencies: ["BY-3"],
          error: {
            code: "dependency_cycle",
            message: "Task dependencies must not contain a cycle.",
            taskId: "BY-1",
          },
        },
      ] as const) {
        const result = yield* runByInProcessEffect(
          root,
          [
            "task",
            "dependencies",
            "set",
            testCase.taskId,
            ...testCase.dependencies.flatMap((dependency) => ["--depends-on", dependency]),
            "--output",
            "json",
          ],
          now,
        );
        expectJsonError(result, {
          error: testCase.error,
          help: ["Use existing Tasks and keep the direct dependency graph acyclic."],
        });
      }

      const missing = yield* runByInProcessEffect(
        root,
        ["task", "dependencies", "set", "BY-404", "--output", "json"],
        now,
      );
      expectJsonError(missing, {
        error: { code: "task_not_found", message: "Task was not found: BY-404", taskId: "BY-404" },
        help: ["Run `by task list --all` to see known Tasks."],
      });

      expect(yield* readGraph(root, taskIds)).toEqual(before);
      expect(yield* readTaskIds(root)).toEqual(taskIds);
    }),
  );
});
