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
    ALTER TABLE candidate_validation_tooling_failures
    RENAME TO candidate_validation_tooling_failures_before_native_snapshot_workspaces
  `);
  yield* sql.unsafe(`
    CREATE TABLE candidate_validation_tooling_failures (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT CHECK (
        sequence BETWEEN 1 AND 9007199254740991
      ),
      validation_run_id TEXT NOT NULL,
      error_kind TEXT NOT NULL CHECK (error_kind IN (
        'snapshot_workspace_setup_failed', 'infrastructure_tooling_failed',
        'git_tooling_failed', 'reviewer_process_execution_failed',
        'prepare_command_execution_tooling_failed', 'check_command_execution_tooling_failed',
        'reviewer_output_contract_failed', 'token_usage_contract_failed'
      )),
      operation_name TEXT NOT NULL,
      error_message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (validation_run_id) REFERENCES candidate_validation_runs(id)
    ) STRICT`);
  yield* sql.unsafe(`
    INSERT INTO candidate_validation_tooling_failures (
      sequence, validation_run_id, error_kind, operation_name, error_message, created_at
    )
    SELECT sequence, validation_run_id,
      CASE error_kind
        WHEN 'validation_workspace_setup_failed' THEN 'snapshot_workspace_setup_failed'
        ELSE error_kind
      END,
      CASE operation_name
        WHEN 'create_temp_ref' THEN 'create_snapshot_workspace'
        WHEN 'create_disposable_workspace' THEN 'create_snapshot_workspace'
        WHEN 'cleanup_validation_workspace' THEN 'cleanup_snapshot_workspace'
        WHEN 'validation_workspace_interrupted' THEN 'snapshot_workspace_interrupted'
        ELSE operation_name
      END,
      error_message, created_at
    FROM candidate_validation_tooling_failures_before_native_snapshot_workspaces
  `);
  yield* sql.unsafe(`
    DROP TABLE candidate_validation_tooling_failures_before_native_snapshot_workspaces
  `);
});
