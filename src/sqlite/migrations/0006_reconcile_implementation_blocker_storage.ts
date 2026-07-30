import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const migration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const taskCounts = yield* sql<{
    readonly count: number | bigint;
  }>`SELECT COUNT(*) AS count FROM tasks`;
  const changeCounts = yield* sql<{
    readonly count: number | bigint;
  }>`SELECT COUNT(*) AS count FROM changes`;
  const taskCount = Number(taskCounts[0]?.count ?? -1);
  const changeCount = Number(changeCounts[0]?.count ?? -1);

  yield* sql.unsafe(`CREATE TABLE tasks_with_blocked_state (
    id TEXT NOT NULL UNIQUE,
    numeric_id INTEGER NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('new', 'todo', 'implementing', 'blocked', 'validating', 'ready', 'done', 'cancelled')),
    completion_kind TEXT CHECK (completion_kind IS NULL OR completion_kind IN ('merged_pr', 'no_change')),
    cancel_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  yield* sql.unsafe(`
    INSERT INTO tasks_with_blocked_state (
      id, numeric_id, title, description, state, completion_kind, cancel_reason, created_at, updated_at
    )
    SELECT id, numeric_id, title, description, state, completion_kind, cancel_reason, created_at, updated_at
    FROM tasks
  `);
  yield* sql.unsafe("DROP TABLE tasks");
  yield* sql.unsafe("ALTER TABLE tasks_with_blocked_state RENAME TO tasks");

  yield* sql.unsafe(`CREATE TABLE changes_with_blocked_state (
    id TEXT PRIMARY KEY,
    repository_common_directory TEXT NOT NULL,
    branch_ref TEXT NOT NULL,
    task_id TEXT UNIQUE,
    state TEXT NOT NULL CHECK (state IN ('open', 'blocked', 'closed')),
    close_reason TEXT CHECK (close_reason IS NULL OR close_reason IN ('completed', 'cancelled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    closed_at TEXT,
    base_ref TEXT,
    base_remote_url TEXT,
    starting_commit TEXT,
    worktree_path TEXT,
    acceptance_context TEXT,
    readiness TEXT CHECK (readiness IS NULL OR readiness IN ('pending', 'ready', 'prepare_failed')),
    prepare_command TEXT,
    prepare_timeout_seconds INTEGER,
    prepare_failure TEXT,
    publication_candidate_id TEXT,
    publication_validation_run_id TEXT,
    publication_owner TEXT,
    publication_repo TEXT,
    publication_base_branch TEXT,
    publication_remote_name TEXT,
    publication_head_branch TEXT,
    publication_expected_head_sha TEXT,
    publication_pr_number INTEGER,
    publication_pr_url TEXT,
    no_change_candidate_id TEXT,
    no_change_validation_run_id TEXT,
    cleanup_state TEXT NOT NULL DEFAULT 'complete' CHECK (cleanup_state IN ('complete', 'pending')),
    cleanup_blocking_reason TEXT,
    FOREIGN KEY (task_id) REFERENCES tasks(id),
    UNIQUE (repository_common_directory, branch_ref),
    CHECK ((state IN ('open', 'blocked') AND close_reason IS NULL AND closed_at IS NULL) OR (state = 'closed' AND close_reason IS NOT NULL AND closed_at IS NOT NULL))
  )`);
  yield* sql.unsafe(`
    INSERT INTO changes_with_blocked_state (
      id, repository_common_directory, branch_ref, task_id, state, close_reason,
      created_at, updated_at, closed_at, base_ref, base_remote_url, starting_commit,
      worktree_path, acceptance_context, readiness, prepare_command,
      prepare_timeout_seconds, prepare_failure, publication_candidate_id,
      publication_validation_run_id, publication_owner, publication_repo,
      publication_base_branch, publication_remote_name, publication_head_branch,
      publication_expected_head_sha, publication_pr_number, publication_pr_url,
      no_change_candidate_id, no_change_validation_run_id, cleanup_state,
      cleanup_blocking_reason
    )
    SELECT
      id, repository_common_directory, branch_ref, task_id, state, close_reason,
      created_at, updated_at, closed_at, base_ref, base_remote_url, starting_commit,
      worktree_path, acceptance_context, readiness, prepare_command,
      prepare_timeout_seconds, prepare_failure, publication_candidate_id,
      publication_validation_run_id, publication_owner, publication_repo,
      publication_base_branch, publication_remote_name, publication_head_branch,
      publication_expected_head_sha, publication_pr_number, publication_pr_url,
      no_change_candidate_id, no_change_validation_run_id, cleanup_state,
      cleanup_blocking_reason
    FROM changes
  `);
  yield* sql.unsafe("DROP TABLE changes");
  yield* sql.unsafe("ALTER TABLE changes_with_blocked_state RENAME TO changes");
  yield* sql.unsafe(
    "CREATE UNIQUE INDEX changes_worktree_path_unique_idx ON changes (worktree_path) WHERE worktree_path IS NOT NULL",
  );
  yield* sql.unsafe(`
    INSERT INTO acceptance_context_versions (change_id, version, context, created_at)
    SELECT changes.id, 1, changes.acceptance_context, changes.created_at
    FROM changes
    WHERE changes.task_id IS NOT NULL
      AND changes.acceptance_context IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM acceptance_context_versions
        WHERE acceptance_context_versions.change_id = changes.id
          AND acceptance_context_versions.version = 1
      )
  `);

  const migratedTaskCounts = yield* sql<{
    readonly count: number | bigint;
  }>`SELECT COUNT(*) AS count FROM tasks`;
  const migratedChangeCounts = yield* sql<{
    readonly count: number | bigint;
  }>`SELECT COUNT(*) AS count FROM changes`;
  if (
    Number(migratedTaskCounts[0]?.count ?? -1) !== taskCount ||
    Number(migratedChangeCounts[0]?.count ?? -1) !== changeCount
  ) {
    return yield* Effect.fail(new Error("Lifecycle migration did not preserve parent rows"));
  }
  const foreignKeyFailures = yield* sql`PRAGMA foreign_key_check`;
  if (foreignKeyFailures.length > 0) {
    return yield* Effect.fail(new Error("Lifecycle migration did not preserve foreign keys"));
  }
});
