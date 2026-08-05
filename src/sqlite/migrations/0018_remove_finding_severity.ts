import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const removeFindingSeverityMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{
    readonly name: string;
  }>`PRAGMA table_info(candidate_validation_findings)`;
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has("severity")) {
    return;
  }

  const beforeCount = yield* sql<{ readonly count: number | bigint }>`
    SELECT COUNT(*) AS count FROM candidate_validation_findings
  `;

  yield* sql.unsafe(`CREATE TABLE candidate_validation_findings_without_severity (
    id TEXT PRIMARY KEY,
    validation_run_id TEXT NOT NULL,
    phase TEXT NOT NULL,
    producer TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    evidence TEXT NOT NULL,
    files TEXT NOT NULL,
    artifact_refs TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (validation_run_id) REFERENCES candidate_validation_runs(id)
  )`);
  yield* sql.unsafe(`
    INSERT INTO candidate_validation_findings_without_severity
      (id, validation_run_id, phase, producer, title, description,
       evidence, files, artifact_refs, created_at, updated_at)
    SELECT id, validation_run_id, phase, producer, title, description,
       evidence, files, artifact_refs, created_at, updated_at
    FROM candidate_validation_findings
  `);
  yield* sql.unsafe("DROP TABLE candidate_validation_findings");
  yield* sql.unsafe(
    "ALTER TABLE candidate_validation_findings_without_severity RENAME TO candidate_validation_findings",
  );

  const afterCount = yield* sql<{ readonly count: number | bigint }>`
    SELECT COUNT(*) AS count FROM candidate_validation_findings
  `;
  if (Number(afterCount[0]?.count ?? -1) !== Number(beforeCount[0]?.count ?? -1)) {
    return yield* Effect.fail(
      new Error("Finding severity removal migration did not preserve Finding rows"),
    );
  }
  const foreignKeyFailures = yield* sql`PRAGMA foreign_key_check`;
  if (foreignKeyFailures.length > 0) {
    return yield* Effect.fail(
      new Error("Finding severity removal migration did not preserve foreign keys"),
    );
  }
});
