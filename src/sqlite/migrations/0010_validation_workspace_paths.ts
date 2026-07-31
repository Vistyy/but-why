import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const validationWorkspacePathsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_schema
    WHERE type = 'table' AND name = 'candidate_validation_workspace_setups'
  `;
  if (tables[0] !== undefined) {
    yield* sql.unsafe(
      "ALTER TABLE candidate_validation_workspace_setups ADD COLUMN worktree_path TEXT",
    );
  }
});
