import { SqlClient } from "@effect/sql";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { cpSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";

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
    }).pipe(
      Effect.provide(
        SqliteClient.layer({ filename: join(commonDirectory, "but-why", "state.sqlite") }),
      ),
      Effect.scoped,
    );
    return root;
  }).pipe(Effect.orDie);
