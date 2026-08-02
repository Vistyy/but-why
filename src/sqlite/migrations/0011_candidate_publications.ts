import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const candidatePublicationsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS candidate_publications (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      change_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      validation_run_id TEXT NOT NULL,
      change_base_sha TEXT NOT NULL,
      head_sha TEXT NOT NULL,
      publication_owner TEXT NOT NULL,
      publication_repo TEXT NOT NULL,
      publication_base_branch TEXT NOT NULL,
      publication_remote_name TEXT NOT NULL,
      publication_head_branch TEXT NOT NULL,
      pull_request_number INTEGER NOT NULL,
      pull_request_url TEXT NOT NULL,
      published_at TEXT NOT NULL,
      FOREIGN KEY (change_id) REFERENCES changes(id),
      UNIQUE (change_id, candidate_id, validation_run_id, head_sha)
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS candidate_publications_change_sequence_idx ON candidate_publications (change_id, sequence)`;
  yield* sql`
    INSERT INTO candidate_publications
      (change_id, candidate_id, validation_run_id, change_base_sha, head_sha,
       publication_owner, publication_repo, publication_base_branch, publication_remote_name,
       publication_head_branch, pull_request_number, pull_request_url, published_at)
    SELECT id, publication_candidate_id, publication_validation_run_id,
      (SELECT change_base_sha FROM candidates WHERE id = publication_candidate_id),
      publication_expected_head_sha, publication_owner, publication_repo, publication_base_branch,
      publication_remote_name, publication_head_branch, publication_pr_number, publication_pr_url,
      updated_at
    FROM changes
    WHERE publication_pr_number IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM candidates
        WHERE candidates.id = changes.publication_candidate_id
          AND candidates.change_base_sha IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM candidate_publications history
        WHERE history.change_id = changes.id
          AND history.candidate_id = changes.publication_candidate_id
          AND history.validation_run_id = changes.publication_validation_run_id
          AND history.head_sha = changes.publication_expected_head_sha
      )
  `;
});
