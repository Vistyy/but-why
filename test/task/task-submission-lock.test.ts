import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { openSqliteExecutionLock } from "../../src/sqlite/sqliteExecutionLock.js";
import { runByWithEnv } from "../support/by-cli.js";
import { createInitializedRepo } from "../support/initializedRepo.js";

describe("Task Submission execution lock across processes", () => {
  it.effect(
    "excludes a separate Submission process until the lock releases",
    () =>
      Effect.gen(function* () {
        const root = createInitializedRepo();
        writeFileSync(join(root, "task.md"), "Implement the locked task.");
        const created = yield* Effect.sync(() =>
          runByWithEnv(
            root,
            {},
            "--json",
            "task",
            "create",
            "--title",
            "Locked",
            "--file",
            "task.md",
          ),
        );
        expect(created.status).toBe(0);

        const lock = openSqliteExecutionLock({ commonDirectory: join(root, ".git") });
        const acquired = yield* lock.withLock({
          owner: "task_submission",
          key: "BY-1",
          effect: Effect.gen(function* () {
            const blocked = yield* Effect.sync(() =>
              runByWithEnv(root, {}, "--json", "task", "submit", "BY-1"),
            );
            expect(blocked.status).toBe(1);
            expect(JSON.parse(blocked.stdout)).toMatchObject({
              error: { code: "submission_in_progress" },
            });
            return blocked;
          }),
        });
        expect(acquired).toBeDefined();

        // After the lock releases, a new process proceeds past the lock and
        // reports the missing canonical main checkout HEAD.
        const released = yield* Effect.sync(() =>
          runByWithEnv(root, {}, "--json", "task", "submit", "BY-1"),
        );
        expect(released.status).toBe(1);
        expect(JSON.parse(released.stdout)).toMatchObject({
          error: { code: "main_checkout_unavailable" },
        });
      }),
    120_000,
  );
});
