import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const backfillPreNativeSnapshotWorkspaceCleanupMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(`
    INSERT OR IGNORE INTO pre_native_snapshot_workspace_cleanups (
      validation_run_id, retired_ref_name, workspace_path, expected_commit_sha
    )
    SELECT workspace.validation_run_id,
      'refs/but-why/validation-runs/' || workspace.validation_run_id || '/validation',
      workspace.workspace_path,
      workspace.expected_commit_sha
    FROM candidate_snapshot_workspaces AS workspace
    INNER JOIN active_validation_runs AS active
      ON active.validation_run_id = workspace.validation_run_id
    WHERE workspace.workspace_path IS NOT NULL
      AND substr(
        workspace.workspace_path,
        -length(
          '/.sandcastle/worktrees/refs-but-why-validation-runs-' ||
          workspace.validation_run_id || '-validation'
        )
      ) =
        '/.sandcastle/worktrees/refs-but-why-validation-runs-' ||
        workspace.validation_run_id || '-validation'
  `);
});
