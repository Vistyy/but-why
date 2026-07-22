import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { publicTaskId } from "../src/task/taskId.js";
import { runByInProcessEffect } from "./support/by-cli.js";
import { createTestWorkspace } from "./support/testWorkspace.js";
import { fakeTaskUseCases } from "./support/taskUseCases.js";

const firstNow = "2026-06-30T12:00:00.000Z";

describe("Task dependency graph", () => {
  it.effect("parses repeated dependency options", () =>
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
});
