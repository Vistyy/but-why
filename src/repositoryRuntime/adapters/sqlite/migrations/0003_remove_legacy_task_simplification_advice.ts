import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const removeLegacyTaskSimplificationAdviceMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(`
    CREATE TEMP TABLE legacy_simplification_advice_sessions (agent_session_id INTEGER PRIMARY KEY)
  `);
  yield* sql.unsafe(`
    INSERT INTO legacy_simplification_advice_sessions (agent_session_id)
    SELECT DISTINCT continuation.agent_session_id
    FROM task_review_simplification_advice AS advice
    JOIN agent_invocations AS invocation
      ON invocation.id = advice.agent_invocation_id
    JOIN agent_continuations AS continuation
      ON continuation.id = invocation.continuation_id
    WHERE advice.outcome = 'completed'
  `);
  yield* sql.unsafe(`
    CREATE TEMP TABLE legacy_simplification_advice_continuations (id INTEGER PRIMARY KEY)
  `);
  yield* sql.unsafe(`
    INSERT INTO legacy_simplification_advice_continuations (id)
    SELECT continuation.id
    FROM agent_continuations AS continuation
    JOIN legacy_simplification_advice_sessions AS session
      ON session.agent_session_id = continuation.agent_session_id
  `);
  yield* sql.unsafe(`
    CREATE TEMP TABLE legacy_simplification_advice_invocations (id INTEGER PRIMARY KEY)
  `);
  yield* sql.unsafe(`
    INSERT INTO legacy_simplification_advice_invocations (id)
    SELECT invocation.id
    FROM agent_invocations AS invocation
    JOIN legacy_simplification_advice_continuations AS continuation
      ON continuation.id = invocation.continuation_id
  `);
  yield* sql.unsafe(`
    DELETE FROM task_review_simplification_advice
    WHERE outcome = 'completed'
  `);
  yield* sql.unsafe(`
    DELETE FROM agent_invocations
    WHERE id IN (SELECT id FROM legacy_simplification_advice_invocations)
  `);
  yield* sql.unsafe(`
    DELETE FROM agent_continuations
    WHERE id IN (SELECT id FROM legacy_simplification_advice_continuations)
  `);
  yield* sql.unsafe(`
    DELETE FROM agent_sessions
    WHERE id IN (SELECT agent_session_id FROM legacy_simplification_advice_sessions)
  `);
  yield* sql.unsafe(`DROP TABLE legacy_simplification_advice_invocations`);
  yield* sql.unsafe(`DROP TABLE legacy_simplification_advice_continuations`);
  yield* sql.unsafe(`DROP TABLE legacy_simplification_advice_sessions`);
});
