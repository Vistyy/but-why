import { SqlClient } from "@effect/sql";
import { copyFileSync, cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";

import { nodeSqliteLayer } from "../../src/sqlite/nodeSqliteClient.js";
import { createGitRepo, runBy } from "./by-cli.js";
import { createTestWorkspace } from "./testWorkspace.js";

export const createInitializedRepo = (workspace?: string): string => {
  const root = createGitRepo(workspace);
  const result = runBy(root, "init", "--task-prefix", "BY");

  if (result.status !== 0) {
    throw new Error(result.stdout || result.stderr);
  }

  return root;
};

export const cloneInitializedRepositoryState = (template: string) =>
  Effect.gen(function* () {
    const root = yield* Effect.sync(() => {
      const workspace = createTestWorkspace();
      mkdirSync(join(workspace, ".git", "but-why"), { recursive: true });
      copyFileSync(
        join(template, ".git", "but-why", "state.sqlite"),
        join(workspace, ".git", "but-why", "state.sqlite"),
      );
      return workspace;
    });
    const commonDirectory = join(root, ".git");
    const templateCommonDirectory = join(template, ".git");
    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE shared_state_identity SET common_directory = ${commonDirectory}`;
      yield* sql`
        UPDATE changes
        SET repository_common_directory = ${commonDirectory},
            worktree_path = CASE
              WHEN worktree_path IS NULL THEN NULL
              ELSE replace(worktree_path, ${template}, ${root})
            END
        WHERE repository_common_directory = ${templateCommonDirectory}
      `;
    }).pipe(
      Effect.provide(nodeSqliteLayer(join(commonDirectory, "but-why", "state.sqlite"))),
      Effect.scoped,
    );
    return root;
  }).pipe(Effect.orDie);

export const cloneInitializedTestRepository = (template: string) =>
  Effect.gen(function* () {
    const root = yield* Effect.sync(() => {
      const workspace = createTestWorkspace();
      cpSync(template, workspace, { recursive: true });
      return workspace;
    });
    const commonDirectory = join(root, ".git");
    const templateCommonDirectory = join(template, ".git");
    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE shared_state_identity SET common_directory = ${commonDirectory}`;
      yield* sql`
        UPDATE changes
        SET repository_common_directory = ${commonDirectory},
            worktree_path = CASE
              WHEN worktree_path IS NULL THEN NULL
              ELSE replace(worktree_path, ${template}, ${root})
            END
        WHERE repository_common_directory = ${templateCommonDirectory}
      `;
    }).pipe(
      Effect.provide(nodeSqliteLayer(join(commonDirectory, "but-why", "state.sqlite"))),
      Effect.scoped,
    );
    return root;
  }).pipe(Effect.orDie);
