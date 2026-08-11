import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const removePreNativeSnapshotWorkspaceCleanupMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const remainingIdentities = yield* sql<{ readonly count: number | bigint }>`
    SELECT COUNT(*) AS count FROM pre_native_snapshot_workspace_cleanups
  `;
  if (Number(remainingIdentities[0]?.count ?? -1) !== 0) {
    return yield* Effect.fail(
      new Error(
        "Pre-native Snapshot Workspace cleanup identity remains in Shared Repository State",
      ),
    );
  }

  yield* sql.unsafe("DROP TABLE pre_native_snapshot_workspace_cleanups");
});
