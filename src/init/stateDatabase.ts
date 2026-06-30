import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export type StateDatabaseChange = "created" | "updated" | "unchanged";

export const stateDatabaseTimeoutMs = 30_000;

type Migration = {
  readonly name: string;
  readonly apply: string;
};

const migrations: readonly Migration[] = [
  {
    name: "001_init",
    apply: "",
  },
  {
    name: "002_tasks",
    apply: `
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT NOT NULL UNIQUE,
        numeric_id INTEGER NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('todo', 'implementing', 'validating', 'needs_input', 'ready', 'done')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
  },
];

export const ensureStateDatabase = (path: string): StateDatabaseChange => {
  const existed = existsSync(path);
  const database = new DatabaseSync(path, { timeout: stateDatabaseTimeoutMs });
  let updated = false;

  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);

    for (const migration of migrations) {
      const result = database
        .prepare("SELECT name FROM schema_migrations WHERE name = ?")
        .get(migration.name);

      if (result === undefined) {
        applyMigration(database, migration);
        updated = true;
      }
    }

    if (!existed) {
      return "created";
    }

    return updated ? "updated" : "unchanged";
  } finally {
    database.close();
  }
};

const applyMigration = (database: DatabaseSync, migration: Migration): void => {
  database.exec("BEGIN");

  try {
    if (migration.apply.length > 0) {
      database.exec(migration.apply);
    }

    database
      .prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)")
      .run(migration.name, new Date().toISOString());
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
};
