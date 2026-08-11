import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as SqlClient from "@effect/sql/SqlClient";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { isTaskPrefix } from "../../src/contracts/taskPrefix.js";
import { initializeRepositoryRuntime } from "../../src/repositoryRuntime/repositoryContext.js";
import { nodeSqliteLayer } from "../../src/sqlite/nodeSqliteClient.js";
import { createGitRepo, runByInProcessEffect } from "../support/by-cli.js";
import { migrateTestRepositoryThrough } from "../support/repositoryMigrations.js";

const writeConfig = (root: string, taskPrefix = "BY") => {
  mkdirSync(join(root, ".but-why"), { recursive: true });
  writeFileSync(join(root, ".but-why/config.json"), `${JSON.stringify({ taskPrefix }, null, 2)}\n`);
};

describe("by init edge cases", () => {
  it.each([
    ["BY"],
    ["A1"],
    ["ABC123"],
    ["A123456789"],
  ])("accepts valid task prefix %s", (taskPrefix) => {
    expect(isTaskPrefix(taskPrefix)).toBe(true);
  });

  it.each([
    ["B"],
    ["by"],
    ["1BY"],
    ["BY-1"],
    ["A1234567890"],
    [""],
  ])("rejects invalid task prefix %j", (taskPrefix) => {
    expect(isTaskPrefix(taskPrefix)).toBe(false);
  });

  it.effect("initializes when .but-why exists without config", () =>
    Effect.gen(function* () {
      const root = createGitRepo();

      mkdirSync(join(root, ".but-why"));
      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout).init.status).toBe("initialized");
      expect(JSON.parse(readFileSync(join(root, ".but-why/config.json"), "utf8"))).toEqual({
        taskPrefix: "BY",
      });
    }),
  );

  it.effect("fails when the reviewers path is a file", () =>
    Effect.gen(function* () {
      const root = createGitRepo();

      writeConfig(root);
      writeFileSync(join(root, ".but-why/reviewers"), "not a directory");
      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        error: {
          code: "invalid_repo_state",
          message: ".but-why/reviewers/ must be a directory.",
          path: ".but-why/reviewers/",
        },
        help: ["Move the conflicting path aside before running init again."],
      });
      expect(existsSync(join(root, ".but-why/reviewers"))).toBe(true);
    }),
  );

  it.effect("initializes repository state through the scoped SQL service", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const result = yield* initializeRepositoryRuntime({ cwd: root, taskPrefix: "BY" });

      expect(result).toMatchObject({ ok: true, status: "initialized" });
      expect(existsSync(join(root, ".git", "but-why", "state.sqlite"))).toBe(true);
    }),
  );

  it.effect("is unchanged when the current state database already exists", () =>
    Effect.gen(function* () {
      const root = createGitRepo();

      expect((yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"])).status).toBe(0);
      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout).init.status).toBe("unchanged");
    }),
  );

  it.effect("reports restored retired lifecycle states during init", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const statePath = join(root, ".git", "but-why", "state.sqlite");
      mkdirSync(join(root, ".but-why"), { recursive: true });
      mkdirSync(join(root, ".git", "but-why"), { recursive: true });
      writeFileSync(
        join(root, ".but-why/config.json"),
        `${JSON.stringify({ taskPrefix: "BY" }, null, 2)}\n`,
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* migrateTestRepositoryThrough(22);
          yield* sql`INSERT INTO tasks (id, numeric_id, title, description, state, created_at, updated_at) VALUES ('BY-1', 1, 'Restored Task', 'Retired state.', 'implementing', '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z')`;
        }).pipe(Effect.provide(nodeSqliteLayer(statePath))),
      );

      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        error: {
          code: "restored_transient_state",
          message: "Shared But Why? state contains retired lifecycle states.",
          tasks: [
            {
              id: "BY-1",
              numericId: 1,
              title: "Restored Task",
              state: "implementing",
              changeId: null,
            },
          ],
        },
        help: [
          "Restore a known-good copy of <git-common-dir>/but-why/state.sqlite, then retry the command.",
        ],
      });
    }),
  );

  it.effect("reports state_store_unavailable when Shared Repository State cannot be opened", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      mkdirSync(join(root, ".git", "but-why", "state.sqlite"), { recursive: true });

      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        error: {
          code: "state_store_unavailable",
          message: "Shared But Why? state is unavailable.",
        },
        help: [
          "Restore <git-common-dir>/but-why/state.sqlite, then run `by init --task-prefix BY`.",
        ],
      });
    }),
  );

  it.effect("reports state_store_unavailable when Shared Repository State migration fails", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const statePath = join(root, ".git", "but-why", "state.sqlite");
      mkdirSync(join(root, ".git", "but-why"), { recursive: true });
      writeFileSync(statePath, "not sqlite");

      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        error: {
          code: "state_store_unavailable",
          message: "Shared But Why? state is unavailable.",
        },
        help: [
          "Restore <git-common-dir>/but-why/state.sqlite, then run `by init --task-prefix BY`.",
        ],
      });
    }),
  );
});
