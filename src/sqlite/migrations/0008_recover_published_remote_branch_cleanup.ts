import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const recoverPublishedRemoteBranchCleanupMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(
    "UPDATE changes SET cleanup_state = 'pending', cleanup_blocking_reason = NULL WHERE state = 'closed' AND close_reason = 'completed' AND publication_pr_number IS NOT NULL AND cleanup_state = 'complete'",
  );
});
