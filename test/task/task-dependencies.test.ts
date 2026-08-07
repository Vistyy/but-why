import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";
import { publicTaskId } from "../../src/task/taskId.js";
import type { TaskUseCases } from "../../src/task/taskUseCases.js";
import { runByInProcessEffect } from "../support/by-cli.js";
import { fakeTaskUseCases } from "../support/taskUseCases.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const now = "2026-06-30T12:00:00.000Z";

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
          "--json",
          "task",
          "create",
          "--title",
          "Dependent",
          "--file",
          descriptionPath,
          "--depends-on",
          "BY-1",
          "--depends-on",
          "BY-2",
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
          "--json",
          "task",
          "dependencies",
          "replace",
          "BY-3",
          "--depends-on",
          "BY-1",
          "--depends-on",
          "BY-2",
        ],
        now,
        {
          taskUseCases: fakeTaskUseCases({
            editTaskDependencies: (input) => {
              replacementDependencies = input.prerequisiteTaskIds;
              return {
                ok: true,
                operation: "replace",
                added: [],
                removed: [],
                unchanged: [publicTaskId("BY-1"), publicTaskId("BY-2")],
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
                  cancelReason: null,
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
        task: { id: "BY-3" },
        operation: "replace",
        added: [],
        removed: [],
        unchanged: ["BY-1", "BY-2"],
        prerequisites: [
          { id: "BY-1", title: "First", state: "new" },
          { id: "BY-2", title: "Second", state: "new" },
        ],
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
          "--json",
          "task",
          "create",
          "--title",
          "Cycle",
          "--file",
          "cycle.md",
          "--depends-on",
          "BY-1",
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
        help: ["Use existing Tasks from `by task list --all --limit all` as direct prerequisites."],
      });
    }),
  );

  it.effect(
    "maps reachable dependency rejections to structured results through the in-process CLI",
    () =>
      Effect.gen(function* () {
        const root = createTestWorkspace();

        for (const testCase of [
          {
            title: "Unknown",
            dependencies: ["BY-404"],
            code: "dependency_unknown_task",
            taskId: "BY-404",
            error: {
              code: "dependency_unknown_task",
              message: "Dependency Task was not found: BY-404",
              taskId: "BY-404",
            },
          },
          {
            title: "Self",
            dependencies: ["BY-4"],
            code: "dependency_self",
            taskId: "BY-4",
            error: {
              code: "dependency_self",
              message: "A Task cannot depend on itself.",
              taskId: "BY-4",
            },
          },
          {
            title: "Duplicate",
            dependencies: ["BY-1", "BY-1"],
            code: "dependency_duplicate",
            taskId: "BY-1",
            error: {
              code: "dependency_duplicate",
              message: "Dependency was provided more than once: BY-1",
              taskId: "BY-1",
            },
          },
        ] as const) {
          const file = `${testCase.title.toLowerCase()}-rejection.md`;
          writeFileSync(join(root, file), `Description for ${testCase.title}`);
          const result = yield* runByInProcessEffect(
            root,
            [
              "--json",
              "task",
              "create",
              "--title",
              testCase.title,
              "--file",
              file,
              ...testCase.dependencies.flatMap((dependency) => ["--depends-on", dependency]),
            ],
            now,
            {
              taskUseCases: dependencyErrorTaskUseCases({
                createTask: () =>
                  Effect.succeed({
                    ok: false,
                    code: testCase.code,
                    taskId: publicTaskId(testCase.taskId),
                  }),
              }),
            },
          );
          expectJsonError(result, {
            error: testCase.error,
            help: [
              "Use existing Tasks from `by task list --all --limit all` as direct prerequisites.",
            ],
          });
        }

        for (const testCase of [
          {
            taskId: "BY-3",
            dependencies: ["BY-404"],
            code: "dependency_unknown_task",
            dependencyTaskId: "BY-404",
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
            code: "dependency_self",
            dependencyTaskId: "BY-3",
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
            code: "dependency_duplicate",
            dependencyTaskId: "BY-2",
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
            code: "dependency_cycle",
            dependencyTaskId: undefined,
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
              "--json",
              "task",
              "dependencies",
              "replace",
              testCase.taskId,
              ...testCase.dependencies.flatMap((dependency) => ["--depends-on", dependency]),
            ],
            now,
            {
              taskUseCases: dependencyErrorTaskUseCases({
                editTaskDependencies: () =>
                  Effect.succeed({
                    ok: false,
                    code: testCase.code,
                    ...(testCase.dependencyTaskId === undefined
                      ? {}
                      : { taskId: publicTaskId(testCase.dependencyTaskId) }),
                  }),
              }),
            },
          );
          expectJsonError(result, {
            error: testCase.error,
            help: ["Use existing Tasks and keep the direct dependency graph acyclic."],
          });
        }

        const missing = yield* runByInProcessEffect(
          root,
          ["--json", "task", "dependencies", "replace", "BY-404", "--depends-on", "BY-1"],
          now,
          {
            taskUseCases: dependencyErrorTaskUseCases({
              editTaskDependencies: () => Effect.succeed({ ok: false, code: "task_not_found" }),
            }),
          },
        );
        expectJsonError(missing, {
          error: {
            code: "task_not_found",
            message: "Task was not found: BY-404",
            taskId: "BY-404",
          },
          help: ["Run `by task list --all --limit all` to see known Tasks."],
        });
      }),
  );
});
