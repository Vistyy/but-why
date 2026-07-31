import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const validationWorkspacePathsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(
    "ALTER TABLE candidate_validation_workspace_setups ADD COLUMN worktree_path TEXT",
  );
});
