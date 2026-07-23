import * as Migrator from "@effect/sql/Migrator";
import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

const baselineStatements = [
  `
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT NOT NULL UNIQUE,
      numeric_id INTEGER NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('new', 'todo', 'implementing', 'validating', 'ready', 'done', 'cancelled')),
      completion_kind TEXT CHECK (completion_kind IS NULL OR completion_kind IN ('merged_pr', 'no_change')),
      cancel_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS task_comments (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      task_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      content TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )
  `,
  "CREATE INDEX IF NOT EXISTS task_comments_task_id_sequence_idx ON task_comments (task_id, sequence)",
  `
    CREATE TABLE IF NOT EXISTS task_dependencies (
      dependent_task_id TEXT NOT NULL,
      prerequisite_task_id TEXT NOT NULL,
      PRIMARY KEY (dependent_task_id, prerequisite_task_id),
      FOREIGN KEY (dependent_task_id) REFERENCES tasks(id),
      FOREIGN KEY (prerequisite_task_id) REFERENCES tasks(id)
    )
  `,
  "CREATE INDEX IF NOT EXISTS task_dependencies_prerequisite_idx ON task_dependencies (prerequisite_task_id, dependent_task_id)",
  `
    CREATE TABLE IF NOT EXISTS changes (
      id TEXT PRIMARY KEY,
      repository_common_directory TEXT NOT NULL,
      branch_ref TEXT NOT NULL,
      task_id TEXT UNIQUE,
      state TEXT NOT NULL CHECK (state IN ('open', 'closed')),
      close_reason TEXT CHECK (close_reason IS NULL OR close_reason IN ('completed', 'cancelled')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT,
      base_ref TEXT,
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
      cleanup_state TEXT NOT NULL DEFAULT 'complete' CHECK (cleanup_state IN ('complete', 'pending')),
      cleanup_blocking_reason TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      UNIQUE (repository_common_directory, branch_ref),
      CHECK ((state = 'open' AND close_reason IS NULL AND closed_at IS NULL) OR (state = 'closed' AND close_reason IS NOT NULL AND closed_at IS NOT NULL))
    )
  `,
  "CREATE UNIQUE INDEX IF NOT EXISTS changes_worktree_path_unique_idx ON changes (worktree_path) WHERE worktree_path IS NOT NULL",
  `
    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      change_id TEXT NOT NULL,
      selected_base_ref TEXT NOT NULL,
      resolved_target_sha TEXT NOT NULL,
      comparison_base_sha TEXT NOT NULL,
      head_sha TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (change_id) REFERENCES changes(id),
      UNIQUE (change_id, comparison_base_sha, head_sha)
    )
  `,
  "CREATE INDEX IF NOT EXISTS candidates_change_id_created_at_idx ON candidates (change_id, created_at)",
  `
    CREATE TABLE IF NOT EXISTS candidate_validation_runs (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      policy_snapshot TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('running', 'complete')),
      outcome TEXT CHECK (outcome IS NULL OR outcome IN ('passed', 'blocked', 'tooling_failed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (candidate_id) REFERENCES candidates(id),
      CHECK ((state = 'running' AND outcome IS NULL) OR (state = 'complete' AND outcome IS NOT NULL))
    )
  `,
  "CREATE UNIQUE INDEX IF NOT EXISTS candidate_validation_runs_reuse_idx ON candidate_validation_runs (candidate_id, policy_snapshot) WHERE outcome = 'passed'",
  `
    CREATE TABLE IF NOT EXISTS candidate_validation_workspace_setups (
      validation_run_id TEXT PRIMARY KEY,
      temp_ref_name TEXT NOT NULL,
      submitted_sha TEXT NOT NULL,
      worktree_head TEXT NOT NULL,
      cleanup_worktree TEXT NOT NULL,
      cleanup_temp_ref TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (validation_run_id) REFERENCES candidate_validation_runs(id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS candidate_validation_tooling_failures (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      validation_run_id TEXT NOT NULL,
      error_kind TEXT NOT NULL,
      operation_name TEXT NOT NULL,
      error_message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (validation_run_id) REFERENCES candidate_validation_runs(id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS candidate_validation_rounds (
      validation_run_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      producer TEXT NOT NULL,
      round_number INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('passed', 'failed')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (validation_run_id, phase, producer, round_number),
      FOREIGN KEY (validation_run_id) REFERENCES candidate_validation_runs(id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS candidate_validation_findings (
      id TEXT PRIMARY KEY,
      validation_run_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      producer TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      severity TEXT CHECK (severity IS NULL OR severity IN ('critical', 'high', 'medium', 'low')),
      evidence TEXT NOT NULL,
      files TEXT NOT NULL,
      artifact_refs TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (validation_run_id) REFERENCES candidate_validation_runs(id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS candidate_validation_artifacts (
      ref TEXT PRIMARY KEY,
      validation_run_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      producer TEXT NOT NULL,
      path TEXT NOT NULL,
      original_bytes INTEGER NOT NULL DEFAULT 0,
      stored_bytes INTEGER NOT NULL DEFAULT 0,
      truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
      created_at TEXT NOT NULL,
      FOREIGN KEY (validation_run_id) REFERENCES candidate_validation_runs(id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS shared_state_identity (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      common_directory TEXT NOT NULL
    )
  `,
] as const;

const baseline = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of baselineStatements) yield* sql.unsafe(statement);
});

export const migrateRepositoryState = Migrator.make({})({
  loader: Migrator.fromRecord({ "0001_baseline": baseline }),
});
