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
  {
    name: "003_task_comments",
    apply: `
      CREATE TABLE IF NOT EXISTS task_comments (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        task_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        content TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );

      CREATE INDEX IF NOT EXISTS task_comments_task_id_sequence_idx
      ON task_comments (task_id, sequence)
    `,
  },
  {
    name: "004_submit_preflight",
    apply: `
      ALTER TABLE tasks ADD COLUMN branch TEXT;

      CREATE UNIQUE INDEX IF NOT EXISTS tasks_branch_unique_idx
      ON tasks (branch)
      WHERE branch IS NOT NULL;

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT NOT NULL UNIQUE,
        task_id TEXT NOT NULL,
        task_run_number INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'error')),
        branch TEXT NOT NULL,
        commit_sha TEXT NOT NULL,
        github_owner TEXT NOT NULL,
        github_repo TEXT NOT NULL,
        github_base_branch TEXT NOT NULL,
        github_remote_name TEXT NOT NULL,
        github_remote_url TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        UNIQUE (task_id, task_run_number)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS runs_active_task_unique_idx
      ON runs (task_id)
      WHERE status = 'active';

      CREATE INDEX IF NOT EXISTS runs_task_id_number_idx
      ON runs (task_id, task_run_number DESC)
    `,
  },
  {
    name: "005_validation_workspace_setup",
    apply: `
      CREATE TABLE IF NOT EXISTS validation_workspace_setups (
        run_id TEXT PRIMARY KEY,
        temp_ref_name TEXT NOT NULL,
        submitted_sha TEXT NOT NULL,
        worktree_path TEXT NOT NULL,
        worktree_head TEXT NOT NULL,
        cleanup_worktree TEXT NOT NULL CHECK (cleanup_worktree IN ('removed', 'not_created', 'failed')),
        cleanup_temp_ref TEXT NOT NULL CHECK (cleanup_temp_ref IN ('removed', 'not_created', 'failed')),
        created_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES runs(id)
      );

      CREATE TABLE IF NOT EXISTS run_tooling_errors (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        operation_name TEXT NOT NULL,
        temp_ref_name TEXT NOT NULL,
        submitted_sha TEXT NOT NULL,
        worktree_path TEXT,
        error_message TEXT NOT NULL,
        cleanup_worktree TEXT NOT NULL CHECK (cleanup_worktree IN ('removed', 'not_created', 'failed')),
        cleanup_temp_ref TEXT NOT NULL CHECK (cleanup_temp_ref IN ('removed', 'not_created', 'failed')),
        created_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES runs(id)
      );

      CREATE INDEX IF NOT EXISTS run_tooling_errors_run_id_sequence_idx
      ON run_tooling_errors (run_id, sequence)
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
