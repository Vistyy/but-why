import * as SqlClient from "@effect/sql/SqlClient";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { nativeSnapshotWorkspacesMigration } from "../../src/sqlite/migrations/0030_native_snapshot_workspaces.js";
import { preNativeSnapshotWorkspaceCleanupMigration } from "../../src/sqlite/migrations/0031_pre_native_snapshot_workspace_cleanup.js";
import { backfillPreNativeSnapshotWorkspaceCleanupMigration } from "../../src/sqlite/migrations/0032_backfill_pre_native_snapshot_workspace_cleanup.js";
import { nodeSqliteLayer } from "../../src/sqlite/nodeSqliteClient.js";

it.scoped("backfills exact cleanup identity after the original native migration", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql.unsafe(`
      CREATE TABLE candidate_validation_runs (id TEXT PRIMARY KEY)
    `);
    yield* sql.unsafe(`
      CREATE TABLE active_validation_runs (
        change_id TEXT PRIMARY KEY,
        validation_run_id TEXT NOT NULL UNIQUE
      )
    `);
    yield* sql.unsafe(`
      CREATE TABLE candidate_validation_workspace_setups (
        validation_run_id TEXT PRIMARY KEY,
        temp_ref_name TEXT NOT NULL,
        submitted_sha TEXT NOT NULL,
        worktree_head TEXT NOT NULL,
        cleanup_worktree TEXT NOT NULL,
        cleanup_temp_ref TEXT NOT NULL,
        created_at TEXT NOT NULL,
        worktree_path TEXT
      )
    `);
    yield* sql.unsafe(`
      CREATE TABLE candidate_validation_tooling_failures (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        validation_run_id TEXT NOT NULL,
        error_kind TEXT NOT NULL,
        operation_name TEXT NOT NULL,
        error_message TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT
    `);
    yield* sql.unsafe(`
      INSERT INTO candidate_validation_workspace_setups (
        validation_run_id, temp_ref_name, submitted_sha, worktree_head,
        cleanup_worktree, cleanup_temp_ref, created_at, worktree_path
      ) VALUES (
        'run-1', 'refs/but-why/validation-runs/run-1/validation', 'candidate-sha',
        'candidate-sha', 'not_created', 'not_created', '2026-08-11T10:00:00.000Z',
        '/tmp/repository/.sandcastle/worktrees/refs-but-why-validation-runs-run-1-validation'
      )
    `);
    yield* sql.unsafe(`
      INSERT INTO candidate_validation_runs (id) VALUES ('run-1')
    `);
    yield* sql.unsafe(`
      INSERT INTO active_validation_runs (change_id, validation_run_id)
      VALUES ('change-1', 'run-1')
    `);
    yield* sql.unsafe(`
      INSERT INTO candidate_validation_tooling_failures (
        validation_run_id, error_kind, operation_name, error_message, created_at
      ) VALUES
        ('run-1', 'validation_workspace_setup_failed', 'create_temp_ref', 'failure',
         '2026-08-11T10:01:00.000Z'),
        ('run-1', 'validation_workspace_setup_failed', 'create_disposable_workspace', 'failure',
         '2026-08-11T10:02:00.000Z'),
        ('run-1', 'validation_workspace_setup_failed', 'cleanup_validation_workspace', 'failure',
         '2026-08-11T10:03:00.000Z')
    `);

    yield* nativeSnapshotWorkspacesMigration;

    yield* sql.unsafe(`
      INSERT INTO candidate_validation_runs (id) VALUES ('run-2')
    `);
    yield* sql.unsafe(`
      INSERT INTO active_validation_runs (change_id, validation_run_id)
      VALUES ('change-2', 'run-2')
    `);
    yield* sql.unsafe(`
      INSERT INTO candidate_snapshot_workspaces (
        validation_run_id, expected_commit_sha, cleanup_workspace, created_at, workspace_path
      ) VALUES (
        'run-2', 'native-sha', 'not_created', '2026-08-11T10:05:00.000Z',
        '/tmp/repository-worktrees/but-why/validation-runs/run-2'
      )
    `);

    yield* preNativeSnapshotWorkspaceCleanupMigration;
    yield* backfillPreNativeSnapshotWorkspaceCleanupMigration;

    const columns = yield* sql<{ readonly name: string }>`
      PRAGMA table_info(candidate_snapshot_workspaces)
    `;
    expect(columns.map(({ name }) => name)).toEqual([
      "validation_run_id",
      "expected_commit_sha",
      "cleanup_workspace",
      "created_at",
      "workspace_path",
    ]);
    const workspaces = yield* sql<{
      readonly validationRunId: string;
      readonly expectedCommitSha: string;
      readonly workspacePath: string;
      readonly cleanupWorkspace: string;
    }>`
      SELECT validation_run_id AS validationRunId,
        expected_commit_sha AS expectedCommitSha,
        workspace_path AS workspacePath,
        cleanup_workspace AS cleanupWorkspace
      FROM candidate_snapshot_workspaces
      ORDER BY validation_run_id
    `;
    expect(workspaces).toEqual([
      {
        validationRunId: "run-1",
        expectedCommitSha: "candidate-sha",
        workspacePath:
          "/tmp/repository/.sandcastle/worktrees/refs-but-why-validation-runs-run-1-validation",
        cleanupWorkspace: "not_created",
      },
      {
        validationRunId: "run-2",
        expectedCommitSha: "native-sha",
        workspacePath: "/tmp/repository-worktrees/but-why/validation-runs/run-2",
        cleanupWorkspace: "not_created",
      },
    ]);
    const preNative = yield* sql<{
      readonly validationRunId: string;
      readonly retiredRefName: string;
      readonly workspacePath: string;
      readonly expectedCommitSha: string;
    }>`
      SELECT validation_run_id AS validationRunId, retired_ref_name AS retiredRefName,
        workspace_path AS workspacePath, expected_commit_sha AS expectedCommitSha
      FROM pre_native_snapshot_workspace_cleanups
    `;
    expect(preNative).toEqual([
      {
        validationRunId: "run-1",
        retiredRefName: "refs/but-why/validation-runs/run-1/validation",
        workspacePath:
          "/tmp/repository/.sandcastle/worktrees/refs-but-why-validation-runs-run-1-validation",
        expectedCommitSha: "candidate-sha",
      },
    ]);
    const failures = yield* sql<{
      readonly errorKind: string;
      readonly operationName: string;
    }>`
      SELECT error_kind AS errorKind, operation_name AS operationName
      FROM candidate_validation_tooling_failures
    `;
    expect(failures).toEqual([
      {
        errorKind: "snapshot_workspace_setup_failed",
        operationName: "create_snapshot_workspace",
      },
      {
        errorKind: "snapshot_workspace_setup_failed",
        operationName: "create_snapshot_workspace",
      },
      {
        errorKind: "snapshot_workspace_setup_failed",
        operationName: "cleanup_snapshot_workspace",
      },
    ]);
  }).pipe(Effect.provide(nodeSqliteLayer(":memory:"))),
);
