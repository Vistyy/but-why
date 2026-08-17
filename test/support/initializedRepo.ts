import { copyFileSync, cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

import { nodeSqliteLayer } from "../../src/sqlite/nodeSqliteClient.js";
import { createGitRepo, runBy } from "./by-cli.js";
import { createTestWorkspace } from "./testWorkspace.js";

export const createInitializedRepo = (workspace?: string): string => {
  const root = createGitRepo(workspace);
  const result = runBy(root, "init", "--id-prefix", "BY");

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
    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE shared_state_identity SET common_directory = ${commonDirectory}`;
      yield* sql`
        UPDATE changes
        SET worktree_path = replace(worktree_path, ${template}, ${root})
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
    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE shared_state_identity SET common_directory = ${commonDirectory}`;
      yield* sql`
        UPDATE changes
        SET worktree_path = replace(worktree_path, ${template}, ${root})
      `;
    }).pipe(
      Effect.provide(nodeSqliteLayer(join(commonDirectory, "but-why", "state.sqlite"))),
      Effect.scoped,
    );
    return root;
  }).pipe(Effect.orDie);
