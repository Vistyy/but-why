import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { runByInProcessEffect } from "./support/by-cli.js";
import { createInitializedRepo } from "./support/initializedRepo.js";

describe("opaque Task ID CLI parsing", () => {
  it.effect.each(["show", "context"])(
    "rejects remote-style Task IDs after opaque parsing in task %s",
    (command) =>
      Effect.gen(function* () {
        const root = initializedRepo();
        const result = yield* runByInProcessEffect(root, [
          "task",
          command,
          "linear/ENG-123:acceptance",
        ]);

        expect(result.status).toBe(1);
        expect(result.stderr).toBe("");
        expect(result.stdout).toContain("code: remote_tasks_not_supported");
        expect(result.stdout).toContain('taskId: "linear/ENG-123:acceptance"');
      }),
  );

  it.effect("rejects remote-style Task IDs in comments before requiring local state", () =>
    Effect.gen(function* () {
      const root = initializedRepo();
      writeFileSync(join(root, "valid.md"), "Valid comment");
      rmSync(join(root, ".git", "but-why", "state.sqlite"));

      const result = yield* runByInProcessEffect(root, [
        "task",
        "comment",
        "linear/ENG-123:acceptance",
        "--file",
        "valid.md",
      ]);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("code: remote_tasks_not_supported");
      expect(result.stdout).toContain('taskId: "linear/ENG-123:acceptance"');
    }),
  );
});

const initializedRepo = (): string => createInitializedRepo();
