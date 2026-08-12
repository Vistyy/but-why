import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const currentCandidateSelectionMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(`
    CREATE TABLE current_candidates (
      change_id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL UNIQUE,
      FOREIGN KEY (change_id) REFERENCES changes(id),
      FOREIGN KEY (candidate_id) REFERENCES candidates(id)
    ) STRICT
  `);
  yield* sql.unsafe(`
    INSERT INTO current_candidates (change_id, candidate_id)
    SELECT candidate.change_id, candidate.id
    FROM candidates AS candidate
    WHERE candidate.id = (
      SELECT selected.id
      FROM candidates AS selected
      WHERE selected.change_id = candidate.change_id
      ORDER BY selected.created_at DESC, selected.id DESC
      LIMIT 1
    )
  `);
});
