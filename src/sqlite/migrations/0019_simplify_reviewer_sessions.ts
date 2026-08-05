import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const simplifyReviewerSessionsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const beforeCount = yield* sql<{ readonly count: number | bigint }>`
    SELECT COUNT(*) AS count FROM reviewer_sessions
  `;

  yield* sql.unsafe(`CREATE TABLE reviewer_sessions_simplified (
    change_id TEXT NOT NULL,
    producer TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    session_reference TEXT NOT NULL,
    PRIMARY KEY (change_id, producer),
    FOREIGN KEY (change_id) REFERENCES changes(id)
  )`);
  yield* sql.unsafe(`
    INSERT INTO reviewer_sessions_simplified (change_id, producer, fingerprint, session_reference)
    SELECT change_id, producer, fingerprint, session_reference
    FROM reviewer_sessions
  `);
  yield* sql.unsafe("DROP TABLE reviewer_sessions");
  yield* sql.unsafe("ALTER TABLE reviewer_sessions_simplified RENAME TO reviewer_sessions");

  const afterCount = yield* sql<{ readonly count: number | bigint }>`
    SELECT COUNT(*) AS count FROM reviewer_sessions
  `;
  if (Number(afterCount[0]?.count ?? -1) !== Number(beforeCount[0]?.count ?? -1)) {
    return yield* Effect.fail(
      new Error("Reviewer Session simplification migration did not preserve Session rows"),
    );
  }
  const foreignKeyFailures = yield* sql`PRAGMA foreign_key_check`;
  if (foreignKeyFailures.length > 0) {
    return yield* Effect.fail(
      new Error("Reviewer Session simplification migration did not preserve foreign keys"),
    );
  }
});
