import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const structuredImplementationDecisionsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(
    "ALTER TABLE implementation_decisions ADD COLUMN choice TEXT NOT NULL DEFAULT ''",
  );
  yield* sql.unsafe(
    "ALTER TABLE implementation_decisions ADD COLUMN rationale TEXT NOT NULL DEFAULT ''",
  );
  yield* sql.unsafe(
    "UPDATE implementation_decisions SET choice = content WHERE choice = '' AND content <> ''",
  );
});
