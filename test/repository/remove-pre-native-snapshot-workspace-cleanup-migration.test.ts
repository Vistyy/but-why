import * as SqlClient from "@effect/sql/SqlClient";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { removePreNativeSnapshotWorkspaceCleanupMigration } from "../../src/sqlite/migrations/0033_remove_pre_native_snapshot_workspace_cleanup.js";
import { nodeSqliteLayer } from "../../src/sqlite/nodeSqliteClient.js";

const createCleanupTable = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(`
    CREATE TABLE pre_native_snapshot_workspace_cleanups (
      validation_run_id TEXT PRIMARY KEY,
      retired_ref_name TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      expected_commit_sha TEXT NOT NULL
    ) STRICT
  `);
});

it.scoped("drops an empty pre-native Snapshot Workspace cleanup table", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* createCleanupTable;
    yield* removePreNativeSnapshotWorkspaceCleanupMigration;

    const tables = yield* sql<{ readonly name: string }>`
      SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name = 'pre_native_snapshot_workspace_cleanups'
    `;
    expect(tables).toEqual([]);
  }).pipe(Effect.provide(nodeSqliteLayer(":memory:"))),
);

it.scoped("stops when pre-native Snapshot Workspace cleanup identity remains", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* createCleanupTable;
    yield* sql.unsafe(`
      INSERT INTO pre_native_snapshot_workspace_cleanups (
        validation_run_id, retired_ref_name, workspace_path, expected_commit_sha
      ) VALUES (
        'run-1', 'refs/but-why/validation-runs/run-1/validation',
        '/repo/.sandcastle/worktrees/run-1', 'candidate-sha'
      )
    `);

    const error = yield* Effect.flip(removePreNativeSnapshotWorkspaceCleanupMigration);
    expect(error).toEqual(
      new Error(
        "Pre-native Snapshot Workspace cleanup identity remains in Shared Repository State",
      ),
    );
    const rows = yield* sql<{ readonly validationRunId: string }>`
      SELECT validation_run_id AS validationRunId
      FROM pre_native_snapshot_workspace_cleanups
    `;
    expect(rows).toEqual([{ validationRunId: "run-1" }]);
  }).pipe(Effect.provide(nodeSqliteLayer(":memory:"))),
);
