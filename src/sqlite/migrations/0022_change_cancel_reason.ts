import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const changeCancelReasonMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{
    readonly name: string;
  }>`PRAGMA table_info(changes)`;
  const columnNames = new Set(columns.map((column) => column.name));
  if (columnNames.has("cancel_reason")) {
    return;
  }

  yield* sql.unsafe("ALTER TABLE changes ADD COLUMN cancel_reason TEXT");

  const afterColumns = yield* sql<{
    readonly name: string;
  }>`PRAGMA table_info(changes)`;
  const afterColumnNames = new Set(afterColumns.map((column) => column.name));
  if (!afterColumnNames.has("cancel_reason")) {
    return yield* Effect.fail(
      new Error("Change cancellation reason migration did not add the cancel_reason column"),
    );
  }
});
