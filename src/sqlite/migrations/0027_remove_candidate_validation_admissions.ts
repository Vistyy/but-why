import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const removeCandidateValidationAdmissionsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe("DROP TABLE IF EXISTS candidate_validation_admissions");
});
