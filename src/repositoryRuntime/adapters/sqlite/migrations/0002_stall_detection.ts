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
      change_id INTEGER NOT NULL REFERENCES changes(id),
      validation_run_id INTEGER NOT NULL UNIQUE REFERENCES validation_runs(id),
      agent_session_id INTEGER NOT NULL REFERENCES agent_sessions(id),
      decision TEXT NOT NULL CHECK (decision IN ('continue', 'stop')),
      reason TEXT NOT NULL,
      configuration TEXT NOT NULL,
      input_snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL,
      CHECK (length(trim(reason)) > 0)
    ) STRICT
  `);
  yield* sql.unsafe(`
    CREATE INDEX stall_detections_change_id_idx ON stall_detections (change_id, id)
  `);
  yield* sql.unsafe(`
    CREATE TABLE stall_detection_agent_invocations (
      stall_detection_id INTEGER NOT NULL REFERENCES stall_detections(id),
      validation_run_id INTEGER NOT NULL REFERENCES validation_runs(id),
      agent_invocation_id INTEGER NOT NULL UNIQUE REFERENCES agent_invocations(id),
      PRIMARY KEY (stall_detection_id, agent_invocation_id)
    ) STRICT
  `);
  yield* sql.unsafe(`
    CREATE TABLE stall_detection_attempts (
      id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND ${safeIntegerMaximum}),
      change_id INTEGER NOT NULL REFERENCES changes(id),
      validation_run_id INTEGER NOT NULL UNIQUE REFERENCES validation_runs(id),
      agent_session_id INTEGER NOT NULL REFERENCES agent_sessions(id),
      diagnostic TEXT NOT NULL,
      created_at TEXT NOT NULL,
      CHECK (length(trim(diagnostic)) > 0)
    ) STRICT
  `);
  yield* sql.unsafe(`
    CREATE TABLE stall_detection_attempt_invocations (
      stall_detection_attempt_id INTEGER NOT NULL REFERENCES stall_detection_attempts(id),
      validation_run_id INTEGER NOT NULL REFERENCES validation_runs(id),
      agent_invocation_id INTEGER NOT NULL UNIQUE REFERENCES agent_invocations(id),
      PRIMARY KEY (stall_detection_attempt_id, agent_invocation_id)
    ) STRICT
  `);
  yield* sql.unsafe(`
    CREATE UNIQUE INDEX implementation_blockers_stall_source_idx
      ON implementation_blockers (source_id) WHERE source_type = 'stall_detection'
  `);
});
