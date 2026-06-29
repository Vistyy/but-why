import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const migrationName = "001_init";

export type StateDatabaseChange = "created" | "updated" | "unchanged";

export const ensureStateDatabase = (path: string): StateDatabaseChange => {
  const existed = existsSync(path);
  const database = new DatabaseSync(path);

  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);

    const result = database
      .prepare("SELECT name FROM schema_migrations WHERE name = ?")
      .get(migrationName);

    if (result === undefined) {
      database
        .prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)")
        .run(migrationName, new Date().toISOString());
      return existed ? "updated" : "created";
    }

    return existed ? "unchanged" : "created";
  } finally {
    database.close();
  }
};
