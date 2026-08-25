import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const taskSimplificationAdviceMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(`
    CREATE TABLE task_simplification_advice (
      task_id INTEGER PRIMARY KEY REFERENCES tasks(id),
      review_id INTEGER NOT NULL UNIQUE REFERENCES task_reviews(id),
      advice TEXT NOT NULL
    ) STRICT
  `);
  yield* sql.unsafe(`
    CREATE TABLE task_review_simplification_advice (
      task_review_id INTEGER PRIMARY KEY REFERENCES task_reviews(id),
      outcome TEXT NOT NULL CHECK (outcome IN ('completed', 'unavailable')),
      advice TEXT,
      unavailable TEXT,
      configuration TEXT,
      agent_session_id INTEGER UNIQUE REFERENCES agent_sessions(id),
      CHECK ((outcome = 'completed') = (advice IS NOT NULL)),
      CHECK ((outcome = 'unavailable') = (unavailable IS NOT NULL))
    ) STRICT
  `);
  yield* sql.unsafe(`
    CREATE TABLE task_review_simplification_advice_invocations (
      task_review_id INTEGER NOT NULL REFERENCES task_reviews(id),
      agent_invocation_id INTEGER NOT NULL UNIQUE REFERENCES agent_invocations(id),
      PRIMARY KEY (task_review_id, agent_invocation_id)
    ) STRICT
  `);
});
