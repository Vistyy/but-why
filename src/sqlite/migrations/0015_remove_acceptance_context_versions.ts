import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const removeAcceptanceContextVersionsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = 'acceptance_context_versions'
  `;
  if (tables.length === 0) return;

  const unsupportedRows = yield* sql<{ readonly count: number | bigint }>`
    SELECT COUNT(*) AS count
    FROM acceptance_context_versions AS version
    LEFT JOIN changes AS change ON change.id = version.change_id
    WHERE change.id IS NULL OR change.acceptance_context IS NULL
  `;
  if (Number(unsupportedRows[0]?.count ?? -1) > 0) {
    return yield* Effect.fail(
      new Error(
        "Acceptance Context version history contains context not preserved by current Changes",
      ),
    );
  }
  const contextCount = yield* sql<{ readonly count: number | bigint }>`
    SELECT COUNT(*) AS count FROM changes WHERE acceptance_context IS NOT NULL
  `;
  const runCount = yield* sql<{ readonly count: number | bigint }>`
    SELECT COUNT(*) AS count FROM candidate_validation_runs
  `;

  yield* sql.unsafe("DROP TABLE acceptance_context_versions");

  const preservedContextCount = yield* sql<{ readonly count: number | bigint }>`
    SELECT COUNT(*) AS count FROM changes WHERE acceptance_context IS NOT NULL
  `;
  const preservedRunCount = yield* sql<{ readonly count: number | bigint }>`
    SELECT COUNT(*) AS count FROM candidate_validation_runs
  `;
  if (
    Number(preservedContextCount[0]?.count ?? -1) !== Number(contextCount[0]?.count ?? -1) ||
    Number(preservedRunCount[0]?.count ?? -1) !== Number(runCount[0]?.count ?? -1)
  ) {
    return yield* Effect.fail(
      new Error(
        "Acceptance Context removal migration did not preserve current Acceptance Context or Validation Run snapshots",
      ),
    );
  }
  const foreignKeyFailures = yield* sql`PRAGMA foreign_key_check`;
  if (foreignKeyFailures.length > 0) {
    return yield* Effect.fail(
      new Error("Acceptance Context removal migration did not preserve foreign keys"),
    );
  }
});
