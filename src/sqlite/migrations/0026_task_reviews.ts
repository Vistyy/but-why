import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const taskReviewsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(`
    CREATE TABLE task_reviews (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      proposal_snapshot TEXT NOT NULL,
      proposal_key TEXT NOT NULL,
      dependency_evidence TEXT NOT NULL,
      base_commit TEXT NOT NULL,
      policy_snapshot TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('running', 'complete')),
      outcome TEXT CHECK (outcome IS NULL OR outcome IN ('passed', 'blocked', 'tooling_failed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      CHECK ((state = 'running' AND outcome IS NULL) OR (state = 'complete' AND outcome IS NOT NULL))
    )
  `);
  yield* sql.unsafe(`
    CREATE INDEX task_reviews_task_created_idx ON task_reviews (task_id, created_at)
  `);
  yield* sql.unsafe(`
    CREATE TABLE active_task_reviews (
      task_id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (review_id) REFERENCES task_reviews(id)
    )
  `);
  yield* sql.unsafe(`
    CREATE TABLE task_review_findings (
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      evidence TEXT NOT NULL,
      files TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (review_id) REFERENCES task_reviews(id)
    )
  `);
  yield* sql.unsafe(`
    CREATE TABLE task_review_tooling_failures (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id TEXT NOT NULL,
      error_kind TEXT NOT NULL,
      operation_name TEXT NOT NULL,
      error_message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (review_id) REFERENCES task_reviews(id)
    )
  `);
  yield* sql.unsafe(`
    CREATE TABLE task_review_completion_failures (
      review_id TEXT PRIMARY KEY,
      operation_name TEXT NOT NULL,
      error_message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (review_id) REFERENCES task_reviews(id)
    )
  `);
  yield* sql.unsafe(`
    CREATE TABLE task_review_workspace_setups (
      review_id TEXT PRIMARY KEY,
      temp_ref_name TEXT NOT NULL,
      submitted_sha TEXT NOT NULL,
      worktree_head TEXT NOT NULL,
      worktree_path TEXT,
      cleanup_worktree TEXT NOT NULL
        CHECK (cleanup_worktree IN ('removed', 'not_created', 'failed')),
      cleanup_temp_ref TEXT NOT NULL
        CHECK (cleanup_temp_ref IN ('removed', 'not_created', 'failed')),
      created_at TEXT NOT NULL,
      FOREIGN KEY (review_id) REFERENCES task_reviews(id)
    )
  `);
});
