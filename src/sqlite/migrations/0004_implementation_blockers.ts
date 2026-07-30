import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const migration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(`
    CREATE TABLE implementation_blockers (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      change_id TEXT NOT NULL,
      reported_at TEXT NOT NULL,
      content TEXT NOT NULL,
      resolved_at TEXT,
      resolution_id TEXT,
      resolution_recorded_at TEXT,
      resolution_content TEXT,
      FOREIGN KEY (change_id) REFERENCES changes(id)
    )
  `);
  yield* sql.unsafe(
    "CREATE UNIQUE INDEX implementation_blockers_active_idx ON implementation_blockers (change_id) WHERE resolved_at IS NULL",
  );
});
