import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const backfillActiveValidationRunsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql<{ readonly name: string }>`
    SELECT name
    FROM sqlite_schema
    WHERE type = 'table'
      AND name IN ('active_validation_runs', 'candidate_validation_runs', 'candidates')
  `;
  if (tables.length < 3) return;

  const duplicates = yield* sql<{
    readonly changeId: string;
    readonly runningCount: number;
  }>`
    SELECT candidates.change_id AS changeId, COUNT(*) AS runningCount
    FROM candidate_validation_runs AS runs
    INNER JOIN candidates ON candidates.id = runs.candidate_id
    WHERE runs.state = 'running'
    GROUP BY candidates.change_id
    HAVING COUNT(*) > 1
  `;

  if (duplicates.length > 0) {
    const details = duplicates
      .map(({ changeId, runningCount }) => `${changeId} (${runningCount} running Validation Runs)`)
      .join(", ");
    return yield* Effect.fail(
      new Error(`Cannot backfill multiple running Validation Runs for one Change: ${details}.`),
    );
  }

  yield* sql`
    INSERT INTO active_validation_runs (change_id, validation_run_id, created_at)
    SELECT candidates.change_id, runs.id, runs.created_at
    FROM candidate_validation_runs AS runs
    INNER JOIN candidates ON candidates.id = runs.candidate_id
    WHERE runs.state = 'running'
  `;
});
