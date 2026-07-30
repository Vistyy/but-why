import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const migration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(`
    CREATE TABLE reviewer_sessions_per_producer (
      change_id TEXT NOT NULL,
      producer TEXT NOT NULL,
      identity TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      session_reference TEXT NOT NULL,
      last_candidate_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (change_id, producer),
      FOREIGN KEY (change_id) REFERENCES changes(id)
    )
  `);
  yield* sql.unsafe(`
    INSERT INTO reviewer_sessions_per_producer
      (change_id, producer, identity, fingerprint, session_reference, last_candidate_id, updated_at)
    SELECT change_id, 'acceptance', identity, fingerprint, session_reference, last_candidate_id, updated_at
    FROM reviewer_sessions
  `);
  yield* sql.unsafe("DROP TABLE reviewer_sessions");
  yield* sql.unsafe("ALTER TABLE reviewer_sessions_per_producer RENAME TO reviewer_sessions");
  yield* sql.unsafe(
    "CREATE INDEX reviewer_sessions_fingerprint_idx ON reviewer_sessions (fingerprint)",
  );
});
