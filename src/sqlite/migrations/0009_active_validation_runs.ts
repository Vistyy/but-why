import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const activeValidationRunsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(`
    CREATE TABLE IF NOT EXISTS active_validation_runs (
      change_id TEXT PRIMARY KEY,
      validation_run_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      FOREIGN KEY (change_id) REFERENCES changes(id),
      FOREIGN KEY (validation_run_id) REFERENCES candidate_validation_runs(id)
    )
  `);
});
