import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

const statements = [
  `
    CREATE TABLE task_reviews (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      proposal_snapshot TEXT NOT NULL,
      dependency_evidence TEXT NOT NULL,
      policy_snapshot TEXT NOT NULL,
      base_ref TEXT NOT NULL,
      base_commit TEXT NOT NULL,
      workspace_path TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL CHECK (state IN ('running', 'complete')),
      outcome TEXT CHECK (outcome IS NULL OR outcome IN ('passed', 'blocked', 'tooling_failed')),
      workspace_cleanup TEXT NOT NULL CHECK (workspace_cleanup IN ('not_created', 'removed', 'failed')),
      tooling_failure TEXT,
      abandon_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      CHECK ((state = 'running' AND outcome IS NULL) OR (state = 'complete' AND outcome IS NOT NULL))
    )
  `,
  "CREATE UNIQUE INDEX task_reviews_one_active_per_task_idx ON task_reviews (task_id) WHERE state = 'running'",
  "CREATE INDEX task_reviews_task_created_idx ON task_reviews (task_id, created_at DESC)",
  `
    CREATE TABLE task_review_findings (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      evidence TEXT NOT NULL,
      files TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (review_id) REFERENCES task_reviews(id)
    )
  `,
  "CREATE INDEX task_review_findings_review_idx ON task_review_findings (review_id, sequence)",
] as const;

export const taskReviewsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of statements) yield* sql.unsafe(statement);
});
