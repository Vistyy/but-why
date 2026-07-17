import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export type StateDatabaseChange = "created" | "updated" | "unchanged";

export class SharedStateIdentityConflictError extends Error {
  constructor(
    readonly expectedCommonDirectory: string,
    readonly actualCommonDirectory: string,
  ) {
    super("Shared But Why state belongs to a different Git repository");
  }
}

export const stateDatabaseTimeoutMs = 30_000;

type Migration = {
  readonly name: string;
  readonly apply: string;
};

const validationPhaseSql =
  "'preflight', 'prepare', 'checks', 'intent_review', 'quality_review', 'publish_pr', 'watch_pr'";
const validationRunStatusSql = "'active', 'failed', 'error'";
const validationPhaseStatusSql =
  "'pending', 'active', 'passed', 'failed', 'skipped', 'workflow_failed'";

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
        severity TEXT CHECK (severity IS NULL OR severity IN ('critical', 'high', 'medium', 'low')),
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
  // SQLite cannot drop NOT NULL from a column in place, so this migration
  // rebuilds the Findings table with the current full schema.
  {
    name: "012_optional_finding_severity",
    apply: `
      CREATE TABLE validation_run_findings_new (
        id TEXT PRIMARY KEY,
        validation_run_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        severity TEXT CHECK (severity IS NULL OR severity IN ('critical', 'high', 'medium', 'low')),
        evidence TEXT NOT NULL,
        files TEXT NOT NULL,
        artifact_refs TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        phase TEXT NOT NULL DEFAULT 'checks' CHECK (phase IN (${validationPhaseSql})),
        producer TEXT NOT NULL DEFAULT 'unknown',
        FOREIGN KEY (validation_run_id) REFERENCES validation_runs(id)
      );

      INSERT INTO validation_run_findings_new (
        id,
        validation_run_id,
        title,
        description,
        severity,
        evidence,
        files,
        artifact_refs,
        created_at,
        updated_at,
        phase,
        producer
      )
      SELECT
        id,
        validation_run_id,
        title,
        description,
        severity,
        evidence,
        files,
        artifact_refs,
        created_at,
        updated_at,
        phase,
        producer
      FROM validation_run_findings;

      DROP TABLE validation_run_findings;
      ALTER TABLE validation_run_findings_new RENAME TO validation_run_findings
    `,
  },
  {
    name: "013_validation_prepare_phase",
    apply: `
      CREATE TABLE validation_run_phase_statuses_new (
        validation_run_id TEXT NOT NULL,
        phase TEXT NOT NULL CHECK (phase IN (${validationPhaseSql})),
        status TEXT NOT NULL CHECK (status IN (${validationPhaseStatusSql})),
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (validation_run_id, phase),
        FOREIGN KEY (validation_run_id) REFERENCES validation_runs(id)
      );

      INSERT INTO validation_run_phase_statuses_new (
        validation_run_id,
        phase,
        status,
        error_message,
        created_at,
        updated_at
      )
      SELECT
        validation_run_id,
        phase,
        status,
        error_message,
        created_at,
        updated_at
      FROM validation_run_phase_statuses;

      DROP TABLE validation_run_phase_statuses;
      ALTER TABLE validation_run_phase_statuses_new RENAME TO validation_run_phase_statuses;

      CREATE TABLE validation_run_rounds_new (
        validation_run_id TEXT NOT NULL,
        phase TEXT NOT NULL CHECK (phase IN (${validationPhaseSql})),
        producer TEXT NOT NULL,
        round_number INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN (${validationPhaseStatusSql})),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (validation_run_id, phase, producer, round_number),
        FOREIGN KEY (validation_run_id) REFERENCES validation_runs(id)
      );

      INSERT INTO validation_run_rounds_new (
        validation_run_id,
        phase,
        producer,
        round_number,
        status,
        created_at,
        updated_at
      )
      SELECT
        validation_run_id,
        phase,
        CASE
          WHEN phase = 'prepare' THEN 'prepare'
          ELSE 'unknown'
        END,
        round_number,
        status,
        created_at,
        updated_at
      FROM validation_run_rounds;

      DROP TABLE validation_run_rounds;
      ALTER TABLE validation_run_rounds_new RENAME TO validation_run_rounds;

      CREATE TABLE validation_run_findings_new (
        id TEXT PRIMARY KEY,
        validation_run_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        severity TEXT CHECK (severity IS NULL OR severity IN ('critical', 'high', 'medium', 'low')),
        evidence TEXT NOT NULL,
        files TEXT NOT NULL,
        artifact_refs TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        phase TEXT NOT NULL DEFAULT 'checks' CHECK (phase IN (${validationPhaseSql})),
        producer TEXT NOT NULL DEFAULT 'unknown',
        FOREIGN KEY (validation_run_id) REFERENCES validation_runs(id)
      );

      INSERT INTO validation_run_findings_new (
        id,
        validation_run_id,
        title,
        description,
        severity,
        evidence,
        files,
        artifact_refs,
        created_at,
        updated_at,
        phase,
        producer
      )
      SELECT
        id,
        validation_run_id,
        title,
        description,
        severity,
        evidence,
        files,
        artifact_refs,
        created_at,
        updated_at,
        phase,
        producer
      FROM validation_run_findings;

      DROP TABLE validation_run_findings;
      ALTER TABLE validation_run_findings_new RENAME TO validation_run_findings;

      CREATE TABLE validation_run_artifacts_new (
        ref TEXT PRIMARY KEY,
        validation_run_id TEXT NOT NULL,
        phase TEXT NOT NULL CHECK (phase IN (${validationPhaseSql})),
        producer TEXT NOT NULL,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (validation_run_id) REFERENCES validation_runs(id)
      );

      INSERT INTO validation_run_artifacts_new (
        ref,
        validation_run_id,
        phase,
        producer,
        path,
        created_at
      )
      SELECT
        ref,
        validation_run_id,
        phase,
        producer,
        path,
        created_at
      FROM validation_run_artifacts;

      DROP TABLE validation_run_artifacts;
      ALTER TABLE validation_run_artifacts_new RENAME TO validation_run_artifacts;

      CREATE TABLE validation_run_logs_new (
        id TEXT PRIMARY KEY,
        validation_run_id TEXT NOT NULL,
        phase TEXT NOT NULL CHECK (phase IN (${validationPhaseSql})),
        producer TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (validation_run_id) REFERENCES validation_runs(id)
      );

      INSERT INTO validation_run_logs_new (
        id,
        validation_run_id,
        phase,
        producer,
        content,
        created_at
      )
      SELECT
        id,
        validation_run_id,
        phase,
        producer,
        content,
        created_at
      FROM validation_run_logs;

      DROP TABLE validation_run_logs;
      ALTER TABLE validation_run_logs_new RENAME TO validation_run_logs;

      CREATE TABLE validation_run_token_usage_new (
        validation_run_id TEXT NOT NULL,
        phase TEXT NOT NULL CHECK (phase IN (${validationPhaseSql})),
        producer TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (validation_run_id, phase, producer),
        FOREIGN KEY (validation_run_id) REFERENCES validation_runs(id)
      );

      INSERT INTO validation_run_token_usage_new (
        validation_run_id,
        phase,
        producer,
        input_tokens,
        output_tokens,
        created_at
      )
      SELECT
        validation_run_id,
        phase,
        producer,
        input_tokens,
        output_tokens,
        created_at
      FROM validation_run_token_usage;

      DROP TABLE validation_run_token_usage;
      ALTER TABLE validation_run_token_usage_new RENAME TO validation_run_token_usage
    `,
  },
  {
    name: "014_task_context_snapshots",
    apply: `
      ALTER TABLE validation_runs
      ADD COLUMN previous_task_state TEXT
      CHECK (previous_task_state IS NULL OR previous_task_state IN ('implementing', 'needs_input'));

      ALTER TABLE validation_runs
      ADD COLUMN task_context_snapshot_state TEXT NOT NULL DEFAULT 'not_required'
      CHECK (task_context_snapshot_state IN ('not_required', 'pending', 'saved', 'failed'));

      ALTER TABLE validation_runs
      ADD COLUMN task_context_snapshot TEXT
    `,
  },
  {
    name: "015_changes_and_candidates",
    apply: `
      CREATE TABLE changes (
        id TEXT PRIMARY KEY,
        repository_common_directory TEXT NOT NULL,
        branch_ref TEXT NOT NULL,
        task_id TEXT UNIQUE,
        state TEXT NOT NULL CHECK (state IN ('open', 'closed')),
        close_reason TEXT CHECK (close_reason IS NULL OR close_reason IN ('completed', 'cancelled')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        closed_at TEXT,
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        UNIQUE (repository_common_directory, branch_ref),
        CHECK (
          (state = 'open' AND close_reason IS NULL AND closed_at IS NULL)
          OR
          (state = 'closed' AND close_reason IS NOT NULL AND closed_at IS NOT NULL)
        )
      );

      CREATE TABLE candidates (
        id TEXT PRIMARY KEY,
        change_id TEXT NOT NULL,
        selected_base_ref TEXT NOT NULL,
        resolved_target_sha TEXT NOT NULL,
        comparison_base_sha TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (change_id) REFERENCES changes(id),
        UNIQUE (change_id, comparison_base_sha, head_sha)
      );

      CREATE INDEX candidates_change_id_created_at_idx
      ON candidates (change_id, created_at)
    `,
  },
  {
    name: "016_change_base_ref",
    apply: `
      ALTER TABLE changes ADD COLUMN base_ref TEXT
    `,
  },
  {
    name: "017_shared_state_identity",
    apply: `
      CREATE TABLE shared_state_identity (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        common_directory TEXT NOT NULL
      )
    `,
  },
];

export const ensureStateDatabase = (
  path: string,
  migrationTimestamp: () => string,
  commonDirectory?: string,
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

    if (commonDirectory !== undefined) {
      ensureSharedStateIdentity(database, commonDirectory);
    }

    if (!existed) {
      return "created";
    }

    return updated ? "updated" : "unchanged";
  } finally {
    database.close();
  }
};

const ensureSharedStateIdentity = (database: DatabaseSync, commonDirectory: string): void => {
  const identity = database
    .prepare("SELECT common_directory AS commonDirectory FROM shared_state_identity WHERE id = 1")
    .get() as { readonly commonDirectory: string } | undefined;

  if (identity === undefined) {
    database
      .prepare("INSERT INTO shared_state_identity (id, common_directory) VALUES (1, ?)")
      .run(commonDirectory);
    return;
  }

  if (identity.commonDirectory !== commonDirectory) {
    throw new SharedStateIdentityConflictError(commonDirectory, identity.commonDirectory);
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
