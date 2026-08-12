import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const candidateValidationReuseMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql.unsafe("DROP INDEX IF EXISTS candidate_validation_runs_reuse_idx");
  yield* sql.unsafe("DROP INDEX IF EXISTS candidate_validation_runs_reuse_without_blocker_idx");
  yield* sql.unsafe(`
    CREATE INDEX candidate_validation_runs_candidate_outcome_idx
    ON candidate_validation_runs (candidate_id, outcome, created_at, id)
  `);
});
