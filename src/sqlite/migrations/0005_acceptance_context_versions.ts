import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const migration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(
    `CREATE TABLE acceptance_context_versions (change_id TEXT NOT NULL, version INTEGER NOT NULL, context TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (change_id, version), FOREIGN KEY (change_id) REFERENCES changes(id))`,
  );
});
