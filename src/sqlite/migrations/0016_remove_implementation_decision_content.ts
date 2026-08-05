import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

type MalformedImplementationDecisionRow = {
  readonly decisionId: string;
  readonly changeId: string;
};

const malformedRows = (sql: SqlClient.SqlClient) =>
  sql<MalformedImplementationDecisionRow>`
    SELECT id AS decisionId, change_id AS changeId
    FROM implementation_decisions
    WHERE NOT (choice IS NOT NULL AND rationale IS NOT NULL)
      AND NOT (content IS NOT NULL AND content <> '' AND choice IS NULL AND rationale IS NULL)
  `;

export const removeImplementationDecisionContentMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{
    readonly name: string;
  }>`PRAGMA table_info(implementation_decisions)`;
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has("content")) {
    return;
  }

  yield* sql.unsafe(`
    DELETE FROM implementation_decisions
    WHERE content IS NOT NULL AND content <> '' AND choice IS NULL AND rationale IS NULL
  `);

  const malformed = yield* malformedRows(sql);
  if (malformed.length > 0) {
    const facts = malformed
      .map((row) => `decisionId=${row.decisionId} changeId=${row.changeId}`)
      .join("; ");
    return yield* Effect.fail(
      new Error(
        "Shared Repository State contains malformed Implementation Decision rows. " +
          "Migration stopped without inventing Choice or Rationale. " +
          `Affected Decision and Change facts: ${facts}. ` +
          "Resolve each affected record explicitly, then retry the migration.",
      ),
    );
  }

  const structuredBefore = yield* sql<{ readonly count: number | bigint }>`
    SELECT COUNT(*) AS count FROM implementation_decisions
  `;

  yield* sql.unsafe(`CREATE TABLE implementation_decisions_without_content (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    change_id TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    choice TEXT NOT NULL,
    rationale TEXT NOT NULL,
    FOREIGN KEY (change_id) REFERENCES changes(id)
  )`);
  yield* sql.unsafe(`
    INSERT INTO implementation_decisions_without_content
      (sequence, id, change_id, recorded_at, choice, rationale)
    SELECT sequence, id, change_id, recorded_at, choice, rationale
    FROM implementation_decisions
  `);
  yield* sql.unsafe("DROP TABLE implementation_decisions");
  yield* sql.unsafe(
    "ALTER TABLE implementation_decisions_without_content RENAME TO implementation_decisions",
  );
  yield* sql.unsafe(
    "CREATE INDEX implementation_decisions_change_sequence_idx ON implementation_decisions (change_id, sequence)",
  );

  const structuredAfter = yield* sql<{ readonly count: number | bigint }>`
    SELECT COUNT(*) AS count FROM implementation_decisions
  `;
  if (Number(structuredAfter[0]?.count ?? -1) !== Number(structuredBefore[0]?.count ?? -1)) {
    return yield* Effect.fail(
      new Error(
        "Implementation Decision content removal migration did not preserve structured rows",
      ),
    );
  }
  const foreignKeyFailures = yield* sql`PRAGMA foreign_key_check`;
  if (foreignKeyFailures.length > 0) {
    return yield* Effect.fail(
      new Error("Implementation Decision content removal migration did not preserve foreign keys"),
    );
  }
});
