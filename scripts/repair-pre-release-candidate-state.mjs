#!/usr/bin/env node

import { copyFileSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const valueFor = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};
const databasePath = valueFor("--database");
const backupPath = valueFor("--backup");
const confirmed = args.includes("--confirm-pre-release-development-state");

if (databasePath === undefined || backupPath === undefined || !confirmed) {
  console.error(
    "usage: repair-pre-release-candidate-state --database <path> --backup <path> --confirm-pre-release-development-state",
  );
  process.exit(2);
}
if (!existsSync(databasePath)) {
  console.error(`error: database does not exist: ${databasePath}`);
  process.exit(1);
}
if (existsSync(backupPath)) {
  console.error(`error: backup path already exists: ${backupPath}`);
  process.exit(1);
}

const open = () => new DatabaseSync(databasePath);
let database = open();
const candidateColumns = () =>
  database.prepare("PRAGMA table_info(candidates)").all().map((row) => row.name);
const hasColumns = (columns, expected) => expected.every((column) => columns.includes(column));
const currentColumns = candidateColumns();
const repairedShape = hasColumns(currentColumns, ["change_base_sha", "head_sha"]);
const retiredShape = hasColumns(currentColumns, [
  "selected_base_ref",
  "resolved_target_sha",
  "comparison_base_sha",
]);

if (repairedShape && !retiredShape) {
  verifyDatabase(database);
  console.log(JSON.stringify({ status: "already_repaired", databasePath }));
  database.close();
  process.exit(0);
}
if (!retiredShape || repairedShape) {
  console.error("error: candidates table is neither the pre-release source shape nor repaired shape");
  database.close();
  process.exit(1);
}

const duplicate = database
  .prepare(`
    SELECT change_id, resolved_target_sha, head_sha, COUNT(*) AS count
    FROM candidates
    GROUP BY change_id, resolved_target_sha, head_sha
    HAVING COUNT(*) > 1
    LIMIT 1
  `)
  .get();
if (duplicate !== undefined) {
  console.error(
    "error: repair would merge distinct Candidate records; preserve the database and resolve the identity collision",
  );
  database.close();
  process.exit(1);
}

const beforeCounts = tableCounts(database);
database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
database.close();
copyFileSync(databasePath, backupPath, 0);
database = open();

try {
  database.exec("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE");
  database.exec(`
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
  `);
  assertCounts(beforeCounts, tableCounts(database));
  verifyDatabase(database);
  database.exec("COMMIT; PRAGMA foreign_keys = ON");
  verifyDatabase(database);
} catch (error) {
  try {
    database.exec("ROLLBACK");
  } catch {}
  database.close();
  console.error(`error: pre-release Candidate state repair rolled back: ${String(error)}`);
  process.exit(1);
}

database.close();
console.log(
  JSON.stringify({
    status: "repaired",
    databasePath,
    backupPath,
    preservedRowCounts: beforeCounts,
  }),
);

function tableCounts(db) {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
  return Object.fromEntries(
    tables.map(({ name }) => [name, db.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get().count]),
  );
}

function assertCounts(before, after) {
  for (const [table, count] of Object.entries(before)) {
    if (after[table] !== count) {
      throw new Error(`row count changed for ${table}: ${count} -> ${String(after[table])}`);
    }
  }
}

function verifyDatabase(db) {
  const foreignKeyFailures = db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyFailures.length > 0) {
    throw new Error(`foreign key check failed: ${JSON.stringify(foreignKeyFailures)}`);
  }
  const integrity = db.prepare("PRAGMA integrity_check").all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
    throw new Error(`integrity check failed: ${JSON.stringify(integrity)}`);
  }
}
