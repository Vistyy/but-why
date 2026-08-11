import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const nativeSnapshotWorkspacesMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(`
    ALTER TABLE candidate_validation_workspace_setups
    RENAME COLUMN submitted_sha TO expected_commit_sha
  `);
  yield* sql.unsafe(`
    ALTER TABLE candidate_validation_workspace_setups
    DROP COLUMN worktree_head
  `);
  yield* sql.unsafe(`
    ALTER TABLE candidate_validation_workspace_setups
    RENAME COLUMN worktree_path TO workspace_path
  `);
  yield* sql.unsafe(`
    ALTER TABLE candidate_validation_workspace_setups
    RENAME COLUMN cleanup_worktree TO cleanup_workspace
  `);
  yield* sql.unsafe(`
    ALTER TABLE candidate_validation_workspace_setups
    DROP COLUMN temp_ref_name
  `);
  yield* sql.unsafe(`
    ALTER TABLE candidate_validation_workspace_setups
    DROP COLUMN cleanup_temp_ref
  `);
  yield* sql.unsafe(`
    ALTER TABLE candidate_validation_workspace_setups
    RENAME TO candidate_snapshot_workspaces
  `);
  yield* sql.unsafe(`
    UPDATE candidate_validation_tooling_failures
    SET error_kind = 'snapshot_workspace_setup_failed'
    WHERE error_kind = 'validation_workspace_setup_failed'
  `);
  yield* sql.unsafe(`
    UPDATE candidate_validation_tooling_failures
    SET operation_name = 'create_snapshot_workspace'
    WHERE operation_name IN ('create_temp_ref', 'create_disposable_workspace')
  `);
  yield* sql.unsafe(`
    UPDATE candidate_validation_tooling_failures
    SET operation_name = 'cleanup_snapshot_workspace'
    WHERE operation_name = 'cleanup_validation_workspace'
  `);
  yield* sql.unsafe(`
    UPDATE candidate_validation_tooling_failures
    SET operation_name = 'snapshot_workspace_interrupted'
    WHERE operation_name = 'validation_workspace_interrupted'
  `);
});
