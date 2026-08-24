import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const stallDetectionRunInvocationsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(`
    CREATE TABLE stall_detection_run_invocations (
      validation_run_id INTEGER NOT NULL REFERENCES validation_runs(id),
      agent_invocation_id INTEGER NOT NULL REFERENCES agent_invocations(id),
      PRIMARY KEY (validation_run_id, agent_invocation_id)
    ) STRICT
  `);
  yield* sql.unsafe(`
    INSERT INTO stall_detection_run_invocations (validation_run_id, agent_invocation_id)
    SELECT validation_run_id, agent_invocation_id
    FROM stall_detection_agent_invocations
    UNION
    SELECT validation_run_id, agent_invocation_id
    FROM stall_detection_attempt_invocations
  `);
});
