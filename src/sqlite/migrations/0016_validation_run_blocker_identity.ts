import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const validationRunBlockerIdentityMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const runColumns = yield* sql<{
    readonly name: string;
  }>`PRAGMA table_info(candidate_validation_runs)`;
  const runColumnNames = new Set(runColumns.map((column) => column.name));
  const hasIdentityColumn = runColumnNames.has("latest_resolved_blocker_id");

  if (!hasIdentityColumn) {
    yield* sql.unsafe(
      "ALTER TABLE candidate_validation_runs ADD COLUMN latest_resolved_blocker_id TEXT",
    );
    yield* sql.unsafe(`
      UPDATE candidate_validation_runs AS run
      SET latest_resolved_blocker_id = (
        SELECT blocker.id
        FROM implementation_blockers AS blocker
        JOIN candidates AS candidate ON candidate.id = run.candidate_id
        WHERE blocker.change_id = candidate.change_id
          AND blocker.resolved_at IS NOT NULL
          AND blocker.resolved_at <= run.created_at
        ORDER BY blocker.resolved_at DESC, blocker.sequence DESC
        LIMIT 1
      )
    `);
  }

  yield* sql.unsafe("DROP INDEX IF EXISTS candidate_validation_runs_reuse_idx");
  yield* sql.unsafe(`
    CREATE UNIQUE INDEX candidate_validation_runs_reuse_idx
    ON candidate_validation_runs (
      candidate_id, policy_snapshot, implementation_decisions, latest_resolved_blocker_id
    )
    WHERE outcome = 'passed'
  `);

  const preservedRunCount = yield* sql<{ readonly count: number | bigint }>`
    SELECT COUNT(*) AS count FROM candidate_validation_runs
  `;
  const unsupportedRuns = yield* sql<{ readonly count: number | bigint }>`
    SELECT COUNT(*) AS count
    FROM candidate_validation_runs
    WHERE state = 'running' AND outcome IS NOT NULL
  `;
  if (Number(preservedRunCount[0]?.count ?? -1) < 0) {
    return yield* Effect.fail(
      new Error("Validation Run blocker identity migration lost Validation Runs"),
    );
  }
  if (Number(unsupportedRuns[0]?.count ?? -1) > 0) {
    return yield* Effect.fail(
      new Error("Validation Run blocker identity migration found inconsistent run states"),
    );
  }
});
