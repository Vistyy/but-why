import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const structuredImplementationDecisionsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe("ALTER TABLE implementation_decisions ADD COLUMN choice TEXT");
  yield* sql.unsafe("ALTER TABLE implementation_decisions ADD COLUMN rationale TEXT");
});
