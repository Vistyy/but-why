import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "@effect/vitest";
import { describe } from "vitest";

import { createTestWorkspace } from "../support/testWorkspace.js";

describe("pre-release Candidate state repair evidence", () => {
  it("preserves records and references while simplifying Candidate identity", () => {
    const database = new DatabaseSync(join(createTestWorkspace(), "state.sqlite"));
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE tasks (id TEXT PRIMARY KEY);
      CREATE TABLE changes (
        id TEXT PRIMARY KEY,
        task_id TEXT REFERENCES tasks(id),
        publication_candidate_id TEXT
      );
      CREATE TABLE candidates (
        id TEXT PRIMARY KEY,
        change_id TEXT NOT NULL REFERENCES changes(id),
        selected_base_ref TEXT NOT NULL,
        resolved_target_sha TEXT NOT NULL,
        comparison_base_sha TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (change_id, resolved_target_sha, comparison_base_sha, head_sha)
      );
      CREATE TABLE candidate_validation_runs (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL REFERENCES candidates(id)
      );
      CREATE TABLE candidate_validation_findings (
        id TEXT PRIMARY KEY,
        validation_run_id TEXT NOT NULL REFERENCES candidate_validation_runs(id)
      );
      CREATE TABLE candidate_validation_artifacts (
        ref TEXT PRIMARY KEY,
        validation_run_id TEXT NOT NULL REFERENCES candidate_validation_runs(id)
      );
      INSERT INTO tasks VALUES ('task-1');
      INSERT INTO changes VALUES ('change-1', 'task-1', NULL);
      INSERT INTO candidates VALUES (
        'candidate-1', 'change-1', 'refs/remotes/origin/main',
        'fresh-base', 'old-merge-base', 'head', '2026-07-25T00:00:00.000Z'
      );
      INSERT INTO candidate_validation_runs VALUES ('run-1', 'candidate-1');
      INSERT INTO candidate_validation_findings VALUES ('finding-1', 'run-1');
      INSERT INTO candidate_validation_artifacts VALUES ('artifact-1', 'run-1');
      UPDATE changes SET publication_candidate_id = 'candidate-1' WHERE id = 'change-1';
    `);
    const countsBefore = tableCounts(database);

    database.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN IMMEDIATE;
      CREATE TABLE candidates_repaired (
        id TEXT PRIMARY KEY,
        change_id TEXT NOT NULL,
        change_base_sha TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (change_id) REFERENCES changes(id),
        UNIQUE (change_id, change_base_sha, head_sha)
      );
      INSERT INTO candidates_repaired (id, change_id, change_base_sha, head_sha, created_at)
      SELECT id, change_id, resolved_target_sha, head_sha, created_at FROM candidates;
      DROP TABLE candidates;
      ALTER TABLE candidates_repaired RENAME TO candidates;
      CREATE INDEX candidates_change_id_created_at_idx ON candidates (change_id, created_at);
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);

    expect(tableCounts(database)).toEqual(countsBefore);
    expect(
      database.prepare("SELECT id, change_id, change_base_sha, head_sha FROM candidates").get(),
    ).toEqual({
      id: "candidate-1",
      change_id: "change-1",
      change_base_sha: "fresh-base",
      head_sha: "head",
    });
    expect(database.prepare("SELECT candidate_id FROM candidate_validation_runs").get()).toEqual({
      candidate_id: "candidate-1",
    });
    expect(database.prepare("SELECT publication_candidate_id FROM changes").get()).toEqual({
      publication_candidate_id: "candidate-1",
    });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    database.close();
  });

  it("detects identities that cannot be repaired losslessly", () => {
    const database = new DatabaseSync(join(createTestWorkspace(), "collision.sqlite"));
    database.exec(`
      CREATE TABLE candidates (
        id TEXT PRIMARY KEY,
        change_id TEXT NOT NULL,
        resolved_target_sha TEXT NOT NULL,
        comparison_base_sha TEXT NOT NULL,
        head_sha TEXT NOT NULL
      );
      INSERT INTO candidates VALUES
        ('candidate-1', 'change-1', 'base', 'merge-base-1', 'head'),
        ('candidate-2', 'change-1', 'base', 'merge-base-2', 'head');
    `);

    expect(
      database
        .prepare(`
          SELECT change_id, resolved_target_sha, head_sha, COUNT(*) AS count
          FROM candidates
          GROUP BY change_id, resolved_target_sha, head_sha
          HAVING COUNT(*) > 1
        `)
        .all(),
    ).toEqual([{ change_id: "change-1", resolved_target_sha: "base", head_sha: "head", count: 2 }]);
    database.close();
  });
});

const tableCounts = (database: DatabaseSync): Record<string, number> =>
  Object.fromEntries(
    database
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map(({ name }) => {
        if (typeof name !== "string") throw new Error("Expected a SQLite table name");
        const quotedName = name.replaceAll('"', '""');
        const row = database.prepare(`SELECT COUNT(*) AS count FROM "${quotedName}"`).get() as
          | { readonly count: unknown }
          | undefined;
        if (typeof row?.count !== "number") {
          throw new Error(`Expected a row count for ${name}`);
        }
        return [name, row.count];
      }),
  );
