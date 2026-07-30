import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const migration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(`
    CREATE TABLE reviewer_sessions (
      change_id TEXT PRIMARY KEY,
      identity TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      session_reference TEXT NOT NULL,
      last_candidate_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (change_id) REFERENCES changes(id)
    )
  `);
  yield* sql.unsafe(
    "CREATE INDEX reviewer_sessions_fingerprint_idx ON reviewer_sessions (fingerprint)",
  );
});
