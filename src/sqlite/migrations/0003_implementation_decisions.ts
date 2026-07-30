import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const implementationDecisionsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(
    "ALTER TABLE candidate_validation_runs ADD COLUMN implementation_decisions TEXT NOT NULL DEFAULT '[]'",
  );
  yield* sql.unsafe(`
    CREATE TABLE implementation_decisions (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      change_id TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      content TEXT NOT NULL,
      FOREIGN KEY (change_id) REFERENCES changes(id)
    )
  `);
  yield* sql.unsafe(
    "CREATE INDEX implementation_decisions_change_sequence_idx ON implementation_decisions (change_id, sequence)",
  );
});
