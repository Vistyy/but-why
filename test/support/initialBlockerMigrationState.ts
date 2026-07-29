import { DatabaseSync } from "node:sqlite";

export const createInitialBlockerMigrationState = (
  statePath: string,
  options: {
    readonly frontier?: 3 | 5;
    readonly intendedLifecycle?: boolean;
    readonly orphanCandidate?: boolean;
  } = {},
): void => {
  const frontier = options.frontier ?? 5;
  const database = new DatabaseSync(statePath);
  try {
    database.exec(`
      PRAGMA foreign_keys = ${options.orphanCandidate === true ? "OFF" : "ON"};
      CREATE TABLE effect_sql_migrations (
        migration_id INTEGER PRIMARY KEY NOT NULL,
        created_at DATETIME NOT NULL DEFAULT current_timestamp,
        name VARCHAR(255) NOT NULL
      );
      INSERT INTO effect_sql_migrations (migration_id, name) VALUES
        (1, 'baseline'),
        (2, 'reviewer_sessions'),
        (3, 'implementation_decisions');
      ${
        frontier === 5
          ? `INSERT INTO effect_sql_migrations (migration_id, name) VALUES
        (4, 'implementation_blockers'),
        (5, 'acceptance_context_versions');`
          : ""
      }

      CREATE TABLE tasks (
        id TEXT NOT NULL UNIQUE,
        numeric_id INTEGER NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN (${options.intendedLifecycle === true ? "'new', 'todo', 'implementing', 'blocked', 'validating', 'ready', 'done', 'cancelled'" : "'new', 'todo', 'implementing', 'validating', 'ready', 'done', 'cancelled'"})),
        completion_kind TEXT CHECK (completion_kind IS NULL OR completion_kind IN ('merged_pr', 'no_change')),
        cancel_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO tasks VALUES
        ('BY-1', 1, 'Blocked work', 'Preserve this Task.', 'implementing', NULL, NULL, '2026-07-01T00:00:00.000Z', '2026-07-02T00:00:00.000Z'),
        ('BY-2', 2, 'Prerequisite', 'Preserve this prerequisite.', 'done', 'merged_pr', NULL, '2026-06-01T00:00:00.000Z', '2026-06-02T00:00:00.000Z');

      CREATE TABLE task_comments (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        task_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        content TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );
      INSERT INTO task_comments (id, task_id, created_at, content)
      VALUES ('comment-1', 'BY-1', '2026-07-01T01:00:00.000Z', 'Preserved comment.');

      CREATE TABLE task_dependencies (
        dependent_task_id TEXT NOT NULL,
        prerequisite_task_id TEXT NOT NULL,
        PRIMARY KEY (dependent_task_id, prerequisite_task_id),
        FOREIGN KEY (dependent_task_id) REFERENCES tasks(id),
        FOREIGN KEY (prerequisite_task_id) REFERENCES tasks(id)
      );
      INSERT INTO task_dependencies VALUES ('BY-1', 'BY-2');

      CREATE TABLE changes (
        id TEXT PRIMARY KEY,
        repository_common_directory TEXT NOT NULL,
        branch_ref TEXT NOT NULL,
        task_id TEXT UNIQUE,
        state TEXT NOT NULL CHECK (state IN (${options.intendedLifecycle === true ? "'open', 'blocked', 'closed'" : "'open', 'closed'"})),
        close_reason TEXT CHECK (close_reason IS NULL OR close_reason IN ('completed', 'cancelled')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        closed_at TEXT,
        base_ref TEXT,
        starting_commit TEXT,
        worktree_path TEXT,
        acceptance_context TEXT,
        readiness TEXT CHECK (readiness IS NULL OR readiness IN ('pending', 'ready', 'prepare_failed')),
        prepare_command TEXT,
        prepare_timeout_seconds INTEGER,
        prepare_failure TEXT,
        publication_candidate_id TEXT,
        publication_validation_run_id TEXT,
        publication_owner TEXT,
        publication_repo TEXT,
        publication_base_branch TEXT,
        publication_remote_name TEXT,
        publication_head_branch TEXT,
        publication_expected_head_sha TEXT,
        publication_pr_number INTEGER,
        publication_pr_url TEXT,
        no_change_candidate_id TEXT,
        no_change_validation_run_id TEXT,
        cleanup_state TEXT NOT NULL DEFAULT 'complete' CHECK (cleanup_state IN ('complete', 'pending')),
        cleanup_blocking_reason TEXT,
        base_remote_url TEXT,
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        UNIQUE (repository_common_directory, branch_ref),
        CHECK ((${options.intendedLifecycle === true ? "state IN ('open', 'blocked')" : "state = 'open'"} AND close_reason IS NULL AND closed_at IS NULL) OR (state = 'closed' AND close_reason IS NOT NULL AND closed_at IS NOT NULL))
      );
      CREATE UNIQUE INDEX changes_worktree_path_unique_idx ON changes (worktree_path) WHERE worktree_path IS NOT NULL;
      INSERT INTO changes (
        id, repository_common_directory, branch_ref, task_id, state, close_reason,
        created_at, updated_at, closed_at, base_ref, starting_commit, worktree_path,
        acceptance_context, readiness, cleanup_state, base_remote_url
      ) VALUES (
        'change-1', '/repo/.git', 'refs/heads/change-1', 'BY-1', 'open', NULL,
        '2026-07-02T00:00:00.000Z', '2026-07-03T00:00:00.000Z', NULL,
        'refs/remotes/origin/main', 'starting-sha', '/repo-worktrees/change-1',
        '{"version":1,"title":"Blocked work","description":"Preserve this Task.","comments":["Preserved comment."]}',
        'ready', 'complete', 'https://example.com/repository.git'
      );

      CREATE TABLE candidates (
        id TEXT PRIMARY KEY,
        change_id TEXT NOT NULL,
        change_base_sha TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (change_id) REFERENCES changes(id),
        UNIQUE (change_id, change_base_sha, head_sha)
      );
      INSERT INTO candidates VALUES ('candidate-1', '${
        options.orphanCandidate === true ? "missing-change" : "change-1"
      }', 'base-sha', 'head-sha', '2026-07-03T01:00:00.000Z');

      CREATE TABLE implementation_decisions (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        change_id TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        content TEXT NOT NULL,
        FOREIGN KEY (change_id) REFERENCES changes(id)
      );
      INSERT INTO implementation_decisions (id, change_id, recorded_at, content)
      VALUES ('decision-1', 'change-1', '2026-07-03T02:00:00.000Z', 'Preserved decision.');

      CREATE TABLE reviewer_sessions (
        change_id TEXT PRIMARY KEY,
        identity TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        session_reference TEXT NOT NULL,
        last_candidate_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (change_id) REFERENCES changes(id)
      );
      INSERT INTO reviewer_sessions VALUES ('change-1', '{}', 'fingerprint', 'session', 'candidate-1', '2026-07-03T03:00:00.000Z');

      ${
        frontier === 5
          ? `CREATE TABLE implementation_blockers (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        change_id TEXT NOT NULL,
        reported_at TEXT NOT NULL,
        content TEXT NOT NULL,
        resolved_at TEXT,
        resolution_id TEXT,
        resolution_recorded_at TEXT,
        resolution_content TEXT,
        FOREIGN KEY (change_id) REFERENCES changes(id)
      );
      CREATE UNIQUE INDEX implementation_blockers_active_idx ON implementation_blockers (change_id) WHERE resolved_at IS NULL;

      CREATE TABLE acceptance_context_versions (
        change_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        context TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (change_id, version),
        FOREIGN KEY (change_id) REFERENCES changes(id)
      );
      ${
        options.intendedLifecycle === true
          ? `INSERT INTO implementation_blockers (id, change_id, reported_at, content)
      VALUES ('blocker-1', 'change-1', '2026-07-03T04:00:00.000Z', 'Preserved blocker.');
      INSERT INTO acceptance_context_versions (change_id, version, context, created_at)
      VALUES ('change-1', 1, '{"version":1,"title":"Blocked work","description":"Preserve this Task.","comments":["Preserved comment."]}', '2026-07-02T00:00:00.000Z');`
          : ""
      }`
          : ""
      }

      CREATE TABLE shared_state_identity (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        common_directory TEXT NOT NULL
      );
    `);
  } finally {
    database.close();
  }
};
