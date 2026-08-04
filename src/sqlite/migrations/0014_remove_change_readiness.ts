import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const removeChangeReadinessMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const changeColumns = yield* sql<{ readonly name: string }>`PRAGMA table_info(changes)`;
  const changeColumnNames = new Set(changeColumns.map((column) => column.name));
  if (!changeColumnNames.has("readiness")) {
    return;
  }

  yield* sql.unsafe(`CREATE TABLE changes_without_readiness (
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
    cleanup_state TEXT NOT NULL DEFAULT 'complete' CHECK (cleanup_state IN ('complete', 'pending')),
    cleanup_blocking_reason TEXT,
    FOREIGN KEY (task_id) REFERENCES tasks(id),
    UNIQUE (repository_common_directory, branch_ref),
    CHECK ((state IN ('open', 'blocked') AND close_reason IS NULL AND closed_at IS NULL) OR (state = 'closed' AND close_reason IS NOT NULL AND closed_at IS NOT NULL))
  )`);
  yield* sql.unsafe(`
    INSERT INTO changes_without_readiness (
      id, repository_common_directory, branch_ref, task_id, state, close_reason,
      created_at, updated_at, closed_at, base_ref, base_remote_url, starting_commit,
      worktree_path, acceptance_context, prepare_command,
      prepare_timeout_seconds, prepare_failure, publication_candidate_id,
      publication_validation_run_id, publication_owner, publication_repo,
      publication_base_branch, publication_remote_name, publication_head_branch,
      publication_expected_head_sha, publication_pr_number, publication_pr_url,
      cleanup_state, cleanup_blocking_reason
    )
    SELECT
      id, repository_common_directory, branch_ref, task_id, state, close_reason,
      created_at, updated_at, closed_at, base_ref, base_remote_url, starting_commit,
      worktree_path, acceptance_context, prepare_command,
      prepare_timeout_seconds, prepare_failure, publication_candidate_id,
      publication_validation_run_id, publication_owner, publication_repo,
      publication_base_branch, publication_remote_name, publication_head_branch,
      publication_expected_head_sha, publication_pr_number, publication_pr_url,
      cleanup_state, cleanup_blocking_reason
    FROM changes
  `);
  yield* sql.unsafe("DROP TABLE changes");
  yield* sql.unsafe("ALTER TABLE changes_without_readiness RENAME TO changes");
  yield* sql.unsafe(
    "CREATE UNIQUE INDEX changes_worktree_path_unique_idx ON changes (worktree_path) WHERE worktree_path IS NOT NULL",
  );

  const foreignKeyFailures = yield* sql`PRAGMA foreign_key_check`;
  if (foreignKeyFailures.length > 0) {
    return yield* Effect.fail(
      new Error("Change readiness removal migration did not preserve foreign keys"),
    );
  }
});
