import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const preNativeSnapshotWorkspaceCleanupMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(`
    CREATE TABLE IF NOT EXISTS pre_native_snapshot_workspace_cleanups (
      validation_run_id TEXT PRIMARY KEY,
      retired_ref_name TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      expected_commit_sha TEXT NOT NULL,
      FOREIGN KEY (validation_run_id) REFERENCES candidate_validation_runs(id)
    )
  `);
});
