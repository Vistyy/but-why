import * as SqlClient from "@effect/sql/SqlClient";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { nativeSnapshotWorkspacesMigration } from "../../src/sqlite/migrations/0029_native_snapshot_workspaces.js";
import { nodeSqliteLayer } from "../../src/sqlite/nodeSqliteClient.js";

it.scoped("preserves exact cleanup identity while removing temporary-ref state", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
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
        error_kind TEXT NOT NULL,
        operation_name TEXT NOT NULL
      )
    `);
    yield* sql.unsafe(`
      INSERT INTO candidate_validation_workspace_setups (
        validation_run_id, temp_ref_name, submitted_sha, worktree_head,
        cleanup_worktree, cleanup_temp_ref, created_at, worktree_path
      ) VALUES (
        'run-1', 'refs/but-why/validation-runs/run-1/validation', 'candidate-sha',
        'candidate-sha', 'not_created', 'not_created', '2026-08-11T10:00:00.000Z',
        '/tmp/repository-worktrees/but-why/validation-runs/run-1'
      )
    `);
    yield* sql.unsafe(`
      INSERT INTO candidate_validation_tooling_failures (error_kind, operation_name)
      VALUES
        ('validation_workspace_setup_failed', 'create_validation_workspace'),
        ('validation_workspace_setup_failed', 'cleanup_validation_workspace')
    `);

    yield* nativeSnapshotWorkspacesMigration;

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
    `;
    expect(workspaces).toEqual([
      {
        validationRunId: "run-1",
        expectedCommitSha: "candidate-sha",
        workspacePath: "/tmp/repository-worktrees/but-why/validation-runs/run-1",
        cleanupWorkspace: "not_created",
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
        operationName: "cleanup_snapshot_workspace",
      },
    ]);
  }).pipe(Effect.provide(nodeSqliteLayer(":memory:"))),
);
