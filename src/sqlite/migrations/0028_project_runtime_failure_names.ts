import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const projectRuntimeFailureNamesMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(`
    UPDATE candidate_validation_tooling_failures
    SET error_kind = 'reviewer_process_execution_failed'
    WHERE error_kind = 'sandcastle_tooling_failed'
  `);
  yield* sql.unsafe(`
    UPDATE candidate_validation_tooling_failures
    SET operation_name = 'create_disposable_workspace'
    WHERE operation_name = 'create_sandcastle_workspace'
  `);
});
