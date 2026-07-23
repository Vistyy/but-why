import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { runByInProcessEffect } from "./support/by-cli.js";
import { fakeTaskUseCases } from "./support/taskUseCases.js";
import { createTestWorkspace } from "./support/testWorkspace.js";

const now = "2026-06-30T12:00:00.000Z";

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
    }),
  );
});
