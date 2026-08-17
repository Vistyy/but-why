import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type * as SqlClient from "@effect/sql/SqlClient";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { RepositoryMigrationFailed } from "../../src/contracts/repositoryStorageError.js";
import { RepositorySql, repositorySqlLayer } from "../../src/sqlite/repositorySql.js";
import { createGitRepo, runByInProcessEffect } from "../support/by-cli.js";
import { runTestProcess } from "../support/testProcess.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const now = "2026-06-30T12:00:00.000Z";

describe("shared repository state", () => {
  it.effect("shares Tasks through Git common state across linked worktrees", () =>
    Effect.gen(function* () {
      const root = yield* initializedRepo();
      git(root, "config", "user.email", "test@example.com");
      git(root, "config", "user.name", "Test User");
      git(root, "add", ".but-why/config.json");
      git(root, "commit", "-m", "configure but why");
      const linked = join(createTestWorkspace(), "linked");
      git(root, "worktree", "add", "-b", "linked", linked);
      writeFileSync(join(root, "task.md"), "Shared Task");

      expect(
        (yield* runByInProcessEffect(
          root,
          ["task", "create", "--title", "Shared", "--file", "task.md"],
          now,
        )).status,
      ).toBe(0);

      const result = yield* runByInProcessEffect(linked, ["task", "list"]);

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        tasks: [{ id: "BY-1", title: "Shared", state: "new" }],
      });
      expect(existsSync(sharedStatePath(root))).toBe(true);
      expect(existsSync(join(root, ".but-why", "state.sqlite"))).toBe(false);
      expect(existsSync(join(linked, ".but-why", "state.sqlite"))).toBe(false);
    }),
  );

  it.effect(
    "shares untracked Task Context drafts through Git common state across linked worktrees",
    () =>
      Effect.gen(function* () {
        const root = yield* initializedRepo();
        git(root, "config", "user.email", "test@example.com");
        git(root, "config", "user.name", "Test User");
        git(root, "add", ".but-why/config.json");
        git(root, "commit", "-m", "configure but why");
        const linked = join(createTestWorkspace(), "linked");
        git(root, "worktree", "add", "-b", "linked", linked);
        writeFileSync(join(root, "task.md"), "Shared Task");
        expect(
          (yield* runByInProcessEffect(
            root,
            ["task", "create", "--title", "Shared", "--file", "task.md"],
            now,
          )).status,
        ).toBe(0);

        const rootStatusBeforeDraft = git(root, "status", "--short");
        const linkedStatusBeforeDraft = git(linked, "status", "--short");

        const draftResult = yield* runByInProcessEffect(root, ["task", "context", "draft", "BY-1"]);
        const draft = JSON.parse(draftResult.stdout) as { draft: { path: string } };
        writeFileSync(draft.draft.path, "Updated from another worktree");

        const applyResult = yield* runByInProcessEffect(
          linked,
          ["task", "context", "apply", "BY-1"],
          now,
        );
        const contextResult = yield* runByInProcessEffect(linked, ["task", "context", "BY-1"]);

        expect(applyResult.status).toBe(0);
        expect(JSON.parse(contextResult.stdout)).toMatchObject({
          task: { title: "Shared", description: "Updated from another worktree" },
        });
        expect(existsSync(draft.draft.path)).toBe(false);
        expect(git(root, "status", "--short")).toBe(rootStatusBeforeDraft);
        expect(git(linked, "status", "--short")).toBe(linkedStatusBeforeDraft);
      }),
  );

  it.effect("does not recreate missing Shared Repository State during a normal operation", () =>
    Effect.gen(function* () {
      const root = yield* initializedRepo();
      rmSync(sharedStatePath(root));

      const result = yield* runByInProcessEffect(root, ["task", "list"]);

      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: { code: "state_store_unavailable" },
      });
      expect(existsSync(sharedStatePath(root))).toBe(false);
    }),
  );

  it.effect("does not create state when it disappears before normal connection acquisition", () =>
    Effect.gen(function* () {
      const root = yield* initializedRepo();
      const statePath = sharedStatePath(root);
      const layer = repositorySqlLayer({ statePath, commonDirectory: join(root, ".git") });
      rmSync(statePath);

      const exit = yield* Effect.exit(Effect.scoped(Effect.provide(RepositorySql, layer)));

      expect(exit._tag).toBe("Failure");
      expect(existsSync(statePath)).toBe(false);
    }),
  );

  it.effect("applies the baseline from an empty migration ledger", () =>
    Effect.gen(function* () {
      const directory = createTestWorkspace();
      const statePath = join(directory, "state.sqlite");
      const database = new DatabaseSync(statePath);
      database.exec(`
        CREATE TABLE effect_sql_migrations (
          migration_id INTEGER PRIMARY KEY NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          name VARCHAR(255) NOT NULL
        )
      `);
      database.close();

      const migrations = yield* Effect.scoped(
        Effect.flatMap(RepositorySql, (repository) =>
          repository.operation(
            "read initialized migration ledger",
            (sql) => sql<{ readonly migrationId: number }>`
              SELECT migration_id AS migrationId FROM effect_sql_migrations ORDER BY migration_id
            `,
          ),
        ).pipe(
          Effect.provide(
            repositorySqlLayer({
              statePath,
              commonDirectory: directory,
              idPrefix: "BY",
              lifecycle: "initialize",
            }),
          ),
        ),
      );

      expect(migrations).toEqual([{ migrationId: 1 }]);
    }),
  );

  it.effect("rejects incomplete and unknown migration ledgers without changing them", () =>
    Effect.gen(function* () {
      const cases = [
        {
          corrupt: (sql: SqlClient.SqlClient) =>
            sql`DELETE FROM effect_sql_migrations WHERE migration_id = 1`,
          expected: [],
        },
        {
          corrupt: (sql: SqlClient.SqlClient) =>
            sql`UPDATE effect_sql_migrations SET migration_id = 0 WHERE migration_id = 1`,
          expected: [0],
        },
        {
          corrupt: (sql: SqlClient.SqlClient) =>
            sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (99, 'unknown')`,
          expected: [1, 99],
        },
      ] as const;
      for (const scenario of cases) {
        const root = yield* initializedRepo();
        const statePath = sharedStatePath(root);
        const config = { statePath, commonDirectory: join(root, ".git") };
        yield* Effect.scoped(
          Effect.flatMap(RepositorySql, (repository) =>
            repository.operation("corrupt migration ledger", scenario.corrupt),
          ).pipe(Effect.provide(repositorySqlLayer(config))),
        );

        const error = yield* Effect.scoped(
          RepositorySql.pipe(Effect.provide(repositorySqlLayer(config))),
        ).pipe(Effect.flip);
        expect(error).toBeInstanceOf(RepositoryMigrationFailed);

        const database = new DatabaseSync(statePath, { readOnly: true });
        const migrations = database
          .prepare(
            "SELECT migration_id AS migrationId FROM effect_sql_migrations ORDER BY migration_id",
          )
          .all()
          // biome-ignore lint/complexity/useLiteralKeys: DatabaseSync rows have an index signature.
          .map((row) => row["migrationId"]);
        database.close();
        expect(migrations).toEqual(scenario.expected);
      }
    }),
  );

  it.effect("rejects shared state that belongs to another Git common directory", () =>
    Effect.gen(function* () {
      const root = yield* initializedRepo();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const repository = yield* RepositorySql;
          yield* repository.operation(
            "change repository identity",
            (sql) => sql`
            UPDATE shared_state_identity
            SET common_directory = ${"/other/.git"}
            WHERE id = 1
          `,
          );
        }).pipe(
          Effect.provide(
            repositorySqlLayer({
              statePath: sharedStatePath(root),
              commonDirectory: join(root, ".git"),
            }),
          ),
        ),
      );

      const result = yield* runByInProcessEffect(root, ["task", "list"]);

      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toEqual({
        error: {
          code: "shared_state_identity_conflict",
          message: "Shared But Why? state belongs to a different Git repository.",
        },
        help: [
          "Restore the repository's own shared state, then run `by init --id-prefix <prefix>`.",
        ],
      });
    }),
  );
});

const initializedRepo = (): Effect.Effect<string> =>
  Effect.gen(function* () {
    const root = createGitRepo();
    expect((yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"])).status).toBe(0);
    return root;
  });

const sharedStatePath = (root: string): string => join(root, ".git", "but-why", "state.sqlite");

const git = (cwd: string, ...args: readonly string[]): string => {
  const result = runTestProcess("git", args, { cwd });

  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};
