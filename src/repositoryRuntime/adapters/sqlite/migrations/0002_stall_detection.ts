import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

const safeIntegerMaximum = 9_007_199_254_740_991;

export const stallDetectionMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(`
    ALTER TABLE changes ADD COLUMN stall_detection_definition TEXT
  `);
  yield* sql.unsafe(`
    ALTER TABLE implementation_blockers ADD COLUMN source_type TEXT
  `);
  yield* sql.unsafe(`
    ALTER TABLE implementation_blockers ADD COLUMN source_id INTEGER
  `);
  yield* sql.unsafe(`
    UPDATE changes SET stall_detection_definition = '{"enabled":false,"profile":null}'
    WHERE stall_detection_definition IS NULL
  `);
  yield* sql.unsafe(`
    UPDATE implementation_blockers SET source_type = 'implementer'
    WHERE source_type IS NULL
  `);
  yield* sql.unsafe(`
    CREATE TABLE stall_detections (
      id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND ${safeIntegerMaximum}),
      validation_run_id INTEGER NOT NULL UNIQUE REFERENCES validation_runs(id),
      agent_session_id INTEGER NOT NULL REFERENCES agent_sessions(id),
      decision TEXT NOT NULL CHECK (decision IN ('continue', 'stop')),
      reason TEXT NOT NULL,
      CHECK (length(trim(reason)) > 0)
    ) STRICT
  `);
  yield* sql.unsafe(`
    CREATE UNIQUE INDEX implementation_blockers_stall_source_idx
      ON implementation_blockers (source_id) WHERE source_type = 'stall_detection'
  `);
});
