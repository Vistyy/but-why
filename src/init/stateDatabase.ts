import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export type StateDatabaseChange = "created" | "updated" | "unchanged";

export const stateDatabaseTimeoutMs = 30_000;

type Migration = {
  readonly name: string;
  readonly apply: string;
};

const validationPhaseSql =
  "'preflight', 'checks', 'intent_review', 'quality_review', 'publish_pr', 'watch_pr'";
const validationRunStatusSql = "'active', 'failed', 'error'";
const validationPhaseStatusSql = "'pending', 'active', 'passed', 'failed', 'workflow_failed'";

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
  // This migration mentions legacy Run table names only to upgrade state databases
  // created before Validation Run became the durable validation model.
  {
    name: "006_validation_runs",
    apply: `
      DROP INDEX IF EXISTS runs_active_task_unique_idx;
      DROP INDEX IF EXISTS runs_task_id_number_idx;
      DROP INDEX IF EXISTS run_tooling_errors_run_id_sequence_idx;

      ALTER TABLE runs RENAME TO validation_runs;
      ALTER TABLE validation_runs RENAME COLUMN task_run_number TO task_validation_number;
      ALTER TABLE validation_workspace_setups RENAME COLUMN run_id TO validation_run_id;
      ALTER TABLE run_tooling_errors RENAME TO validation_run_tooling_errors;
      ALTER TABLE validation_run_tooling_errors RENAME COLUMN run_id TO validation_run_id;
      ALTER TABLE validation_run_tooling_errors
      ADD COLUMN error_kind TEXT NOT NULL DEFAULT 'validation_workspace_setup_failed';

      CREATE UNIQUE INDEX IF NOT EXISTS validation_runs_active_task_unique_idx
      ON validation_runs (task_id)
      WHERE status = 'active';

      CREATE INDEX IF NOT EXISTS validation_runs_task_id_number_idx
      ON validation_runs (task_id, task_validation_number DESC);

      CREATE INDEX IF NOT EXISTS validation_run_tooling_errors_validation_run_id_sequence_idx
      ON validation_run_tooling_errors (validation_run_id, sequence);

      CREATE TABLE IF NOT EXISTS validation_run_phase_statuses (
        validation_run_id TEXT NOT NULL,
        phase TEXT NOT NULL CHECK (phase IN (${validationPhaseSql})),
        status TEXT NOT NULL CHECK (status IN (${validationPhaseStatusSql})),
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (validation_run_id, phase),
        FOREIGN KEY (validation_run_id) REFERENCES validation_runs(id)
      );

      CREATE TABLE IF NOT EXISTS validation_run_rounds (
        validation_run_id TEXT NOT NULL,
        phase TEXT NOT NULL CHECK (phase IN (${validationPhaseSql})),
        round_number INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN (${validationPhaseStatusSql})),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (validation_run_id, phase, round_number),
        FOREIGN KEY (validation_run_id) REFERENCES validation_runs(id)
      );

      CREATE TABLE IF NOT EXISTS validation_run_findings (
        id TEXT PRIMARY KEY,
        validation_run_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
        evidence TEXT NOT NULL,
        files TEXT NOT NULL,
        artifact_refs TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (validation_run_id) REFERENCES validation_runs(id)
      );

      CREATE TABLE IF NOT EXISTS validation_run_logs (
        id TEXT PRIMARY KEY,
        validation_run_id TEXT NOT NULL,
        phase TEXT NOT NULL CHECK (phase IN (${validationPhaseSql})),
        producer TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (validation_run_id) REFERENCES validation_runs(id)
      );

      CREATE TABLE IF NOT EXISTS validation_run_artifacts (
        ref TEXT PRIMARY KEY,
        validation_run_id TEXT NOT NULL,
        phase TEXT NOT NULL CHECK (phase IN (${validationPhaseSql})),
        producer TEXT NOT NULL,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (validation_run_id) REFERENCES validation_runs(id)
      );

      CREATE TABLE IF NOT EXISTS validation_run_token_usage (
        validation_run_id TEXT NOT NULL,
        phase TEXT NOT NULL CHECK (phase IN (${validationPhaseSql})),
        producer TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (validation_run_id, phase, producer),
        FOREIGN KEY (validation_run_id) REFERENCES validation_runs(id)
      )
    `,
  },
  {
    name: "007_general_validation_tooling_errors",
    apply: `
      DROP INDEX IF EXISTS validation_run_tooling_errors_validation_run_id_sequence_idx;

      CREATE TABLE validation_run_tooling_errors_new (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        validation_run_id TEXT NOT NULL,
        error_kind TEXT NOT NULL,
        operation_name TEXT NOT NULL,
        temp_ref_name TEXT,
        submitted_sha TEXT,
        worktree_path TEXT,
        error_message TEXT NOT NULL,
        cleanup_worktree TEXT CHECK (cleanup_worktree IS NULL OR cleanup_worktree IN ('removed', 'not_created', 'failed')),
        cleanup_temp_ref TEXT CHECK (cleanup_temp_ref IS NULL OR cleanup_temp_ref IN ('removed', 'not_created', 'failed')),
        created_at TEXT NOT NULL,
        FOREIGN KEY (validation_run_id) REFERENCES validation_runs(id)
      );

      INSERT INTO validation_run_tooling_errors_new (
        sequence,
        validation_run_id,
        error_kind,
        operation_name,
        temp_ref_name,
        submitted_sha,
        worktree_path,
        error_message,
        cleanup_worktree,
        cleanup_temp_ref,
        created_at
      )
      SELECT
        sequence,
        validation_run_id,
        error_kind,
        operation_name,
        temp_ref_name,
        submitted_sha,
        worktree_path,
        error_message,
        cleanup_worktree,
        cleanup_temp_ref,
        created_at
      FROM validation_run_tooling_errors;

      DROP TABLE validation_run_tooling_errors;
      ALTER TABLE validation_run_tooling_errors_new RENAME TO validation_run_tooling_errors;

      CREATE INDEX validation_run_tooling_errors_validation_run_id_sequence_idx
      ON validation_run_tooling_errors (validation_run_id, sequence)
    `,
  },
  {
    name: "008_drop_durable_validation_workspace_path",
    apply: `
      ALTER TABLE validation_workspace_setups DROP COLUMN worktree_path
    `,
  },
  {
    name: "009_failed_validation_run_status",
    apply: `
      DROP INDEX IF EXISTS validation_runs_active_task_unique_idx;
      DROP INDEX IF EXISTS validation_runs_task_id_number_idx;

      CREATE TABLE validation_runs_new (
        id TEXT NOT NULL UNIQUE,
        task_id TEXT NOT NULL,
        task_validation_number INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN (${validationRunStatusSql})),
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
        UNIQUE (task_id, task_validation_number)
      );

      INSERT INTO validation_runs_new (
        id,
        task_id,
        task_validation_number,
        status,
        branch,
        commit_sha,
        github_owner,
        github_repo,
        github_base_branch,
        github_remote_name,
        github_remote_url,
        created_at,
        updated_at
      )
      SELECT
        id,
        task_id,
        task_validation_number,
        status,
        branch,
        commit_sha,
        github_owner,
        github_repo,
        github_base_branch,
        github_remote_name,
        github_remote_url,
        created_at,
        updated_at
      FROM validation_runs;

      DROP TABLE validation_runs;
      ALTER TABLE validation_runs_new RENAME TO validation_runs;

      CREATE UNIQUE INDEX validation_runs_active_task_unique_idx
      ON validation_runs (task_id)
      WHERE status = 'active';

      CREATE INDEX validation_runs_task_id_number_idx
      ON validation_runs (task_id, task_validation_number DESC)
    `,
  },
  {
    name: "010_validation_finding_phase",
    apply: `
      ALTER TABLE validation_run_findings
      ADD COLUMN phase TEXT NOT NULL DEFAULT 'checks' CHECK (phase IN (${validationPhaseSql}))
    `,
  },
  {
    name: "011_validation_finding_producer",
    apply: `
      ALTER TABLE validation_run_findings
      ADD COLUMN producer TEXT NOT NULL DEFAULT 'unknown';

      UPDATE validation_run_findings
      SET producer = substr(title, length('Check failed: ') + 1)
      WHERE phase = 'checks' AND title LIKE 'Check failed: %';

      UPDATE validation_run_findings
      SET producer = substr(title, length('Check timed out: ') + 1)
      WHERE phase = 'checks' AND title LIKE 'Check timed out: %'
    `,
  },
];

export const ensureStateDatabase = (
  path: string,
  migrationTimestamp: () => string,
): StateDatabaseChange => {
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
        applyMigration(database, migration, migrationTimestamp);
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

const applyMigration = (
  database: DatabaseSync,
  migration: Migration,
  migrationTimestamp: () => string,
): void => {
  database.exec("BEGIN");

  try {
    if (migration.apply.length > 0) {
      database.exec(migration.apply);
    }

    database
      .prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)")
      .run(migration.name, migrationTimestamp());
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
};
