import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const structuredImplementationDecisionsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{
    readonly name: string;
  }>`PRAGMA table_info(implementation_decisions)`;
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("choice"))
    yield* sql.unsafe("ALTER TABLE implementation_decisions ADD COLUMN choice TEXT");
  if (!names.has("rationale"))
    yield* sql.unsafe("ALTER TABLE implementation_decisions ADD COLUMN rationale TEXT");
});
