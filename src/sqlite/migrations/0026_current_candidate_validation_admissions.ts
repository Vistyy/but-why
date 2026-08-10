import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const currentCandidateValidationAdmissionsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(`
    CREATE TABLE IF NOT EXISTS candidate_validation_admissions (
      candidate_id TEXT PRIMARY KEY,
      validation_run_id TEXT NOT NULL UNIQUE,
      FOREIGN KEY (candidate_id) REFERENCES candidates(id),
      FOREIGN KEY (validation_run_id) REFERENCES candidate_validation_runs(id)
    )
  `);
  yield* sql.unsafe(`
    INSERT OR IGNORE INTO candidate_validation_admissions (candidate_id, validation_run_id)
    SELECT candidate.id, (
      SELECT run.id
      FROM candidate_validation_runs AS run
      WHERE run.candidate_id = candidate.id
      ORDER BY run.created_at DESC, run.id DESC
      LIMIT 1
    )
    FROM candidates AS candidate
    WHERE EXISTS (
      SELECT 1 FROM candidate_validation_runs AS run
      WHERE run.candidate_id = candidate.id
    )
  `);
});
