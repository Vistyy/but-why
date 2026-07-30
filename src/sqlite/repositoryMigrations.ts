import * as Migrator from "@effect/sql/Migrator";
import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

const baselineStatements = [
  `
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT NOT NULL UNIQUE,
      numeric_id INTEGER NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('new', 'todo', 'implementing', 'validating', 'ready', 'done', 'cancelled')),
      completion_kind TEXT CHECK (completion_kind IS NULL OR completion_kind IN ('merged_pr', 'no_change')),
      cancel_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS task_comments (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      task_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      content TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )
  `,
  "CREATE INDEX IF NOT EXISTS task_comments_task_id_sequence_idx ON task_comments (task_id, sequence)",
  `
    CREATE TABLE IF NOT EXISTS task_dependencies (
      dependent_task_id TEXT NOT NULL,
      prerequisite_task_id TEXT NOT NULL,
      PRIMARY KEY (dependent_task_id, prerequisite_task_id),
      FOREIGN KEY (dependent_task_id) REFERENCES tasks(id),
      FOREIGN KEY (prerequisite_task_id) REFERENCES tasks(id)
    )
  `,
  "CREATE INDEX IF NOT EXISTS task_dependencies_prerequisite_idx ON task_dependencies (prerequisite_task_id, dependent_task_id)",
  `
    CREATE TABLE IF NOT EXISTS changes (
      id TEXT PRIMARY KEY,
      repository_common_directory TEXT NOT NULL,
      branch_ref TEXT NOT NULL,
      task_id TEXT UNIQUE,
      state TEXT NOT NULL CHECK (state IN ('open', 'closed')),
      close_reason TEXT CHECK (close_reason IS NULL OR close_reason IN ('completed', 'cancelled')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT,
      base_ref TEXT,
      base_remote_url TEXT,
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
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      UNIQUE (repository_common_directory, branch_ref),
      CHECK ((state = 'open' AND close_reason IS NULL AND closed_at IS NULL) OR (state = 'closed' AND close_reason IS NOT NULL AND closed_at IS NOT NULL))
    )
  `,
  "CREATE UNIQUE INDEX IF NOT EXISTS changes_worktree_path_unique_idx ON changes (worktree_path) WHERE worktree_path IS NOT NULL",
  `
    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      change_id TEXT NOT NULL,
      change_base_sha TEXT NOT NULL,
      head_sha TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (change_id) REFERENCES changes(id),
      UNIQUE (change_id, change_base_sha, head_sha)
    )
  `,
  "CREATE INDEX IF NOT EXISTS candidates_change_id_created_at_idx ON candidates (change_id, created_at)",
  `
    CREATE TABLE IF NOT EXISTS candidate_validation_runs (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      policy_snapshot TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('running', 'complete')),
      outcome TEXT CHECK (outcome IS NULL OR outcome IN ('passed', 'blocked', 'tooling_failed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (candidate_id) REFERENCES candidates(id),
      CHECK ((state = 'running' AND outcome IS NULL) OR (state = 'complete' AND outcome IS NOT NULL))
    )
  `,
  "CREATE UNIQUE INDEX IF NOT EXISTS candidate_validation_runs_reuse_idx ON candidate_validation_runs (candidate_id, policy_snapshot) WHERE outcome = 'passed'",
  `
    CREATE TABLE IF NOT EXISTS candidate_validation_workspace_setups (
      validation_run_id TEXT PRIMARY KEY,
      temp_ref_name TEXT NOT NULL,
      submitted_sha TEXT NOT NULL,
      worktree_head TEXT NOT NULL,
      cleanup_worktree TEXT NOT NULL,
      cleanup_temp_ref TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (validation_run_id) REFERENCES candidate_validation_runs(id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS candidate_validation_tooling_failures (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      validation_run_id TEXT NOT NULL,
      error_kind TEXT NOT NULL,
      operation_name TEXT NOT NULL,
      error_message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (validation_run_id) REFERENCES candidate_validation_runs(id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS candidate_validation_rounds (
      validation_run_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      producer TEXT NOT NULL,
      round_number INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('passed', 'failed')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (validation_run_id, phase, producer, round_number),
      FOREIGN KEY (validation_run_id) REFERENCES candidate_validation_runs(id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS candidate_validation_findings (
      id TEXT PRIMARY KEY,
      validation_run_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      producer TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      severity TEXT CHECK (severity IS NULL OR severity IN ('critical', 'high', 'medium', 'low')),
      evidence TEXT NOT NULL,
      files TEXT NOT NULL,
      artifact_refs TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (validation_run_id) REFERENCES candidate_validation_runs(id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS candidate_validation_artifacts (
      ref TEXT PRIMARY KEY,
      validation_run_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      producer TEXT NOT NULL,
      path TEXT NOT NULL,
      original_bytes INTEGER NOT NULL DEFAULT 0,
      stored_bytes INTEGER NOT NULL DEFAULT 0,
      truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
      created_at TEXT NOT NULL,
      FOREIGN KEY (validation_run_id) REFERENCES candidate_validation_runs(id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS shared_state_identity (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      common_directory TEXT NOT NULL
    )
  `,
] as const;

const baseline = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of baselineStatements) yield* sql.unsafe(statement);
});

const implementationDecisions = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(
    "ALTER TABLE candidate_validation_runs ADD COLUMN implementation_decisions TEXT NOT NULL DEFAULT '[]'",
  );
  yield* sql.unsafe(`
    CREATE TABLE implementation_decisions (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      change_id TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      content TEXT NOT NULL,
      FOREIGN KEY (change_id) REFERENCES changes(id)
    )
  `);
  yield* sql.unsafe(
    "CREATE INDEX implementation_decisions_change_sequence_idx ON implementation_decisions (change_id, sequence)",
  );
});

const implementationBlockers = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(`
    CREATE TABLE implementation_blockers (
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
    )
  `);
  yield* sql.unsafe(
    "CREATE UNIQUE INDEX implementation_blockers_active_idx ON implementation_blockers (change_id) WHERE resolved_at IS NULL",
  );
});

const acceptanceContextVersions = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(
    `CREATE TABLE acceptance_context_versions (change_id TEXT NOT NULL, version INTEGER NOT NULL, context TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (change_id, version), FOREIGN KEY (change_id) REFERENCES changes(id))`,
  );
});

const reconcileImplementationBlockerStorage = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const taskCounts = yield* sql<{
    readonly count: number | bigint;
  }>`SELECT COUNT(*) AS count FROM tasks`;
  const changeCounts = yield* sql<{
    readonly count: number | bigint;
  }>`SELECT COUNT(*) AS count FROM changes`;
  const taskCount = Number(taskCounts[0]?.count ?? -1);
  const changeCount = Number(changeCounts[0]?.count ?? -1);

  yield* sql.unsafe(`CREATE TABLE tasks_with_blocked_state (
    id TEXT NOT NULL UNIQUE,
    numeric_id INTEGER NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('new', 'todo', 'implementing', 'blocked', 'validating', 'ready', 'done', 'cancelled')),
    completion_kind TEXT CHECK (completion_kind IS NULL OR completion_kind IN ('merged_pr', 'no_change')),
    cancel_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  yield* sql.unsafe(`
    INSERT INTO tasks_with_blocked_state (
      id, numeric_id, title, description, state, completion_kind, cancel_reason, created_at, updated_at
    )
    SELECT id, numeric_id, title, description, state, completion_kind, cancel_reason, created_at, updated_at
    FROM tasks
  `);
  yield* sql.unsafe("DROP TABLE tasks");
  yield* sql.unsafe("ALTER TABLE tasks_with_blocked_state RENAME TO tasks");

  yield* sql.unsafe(`CREATE TABLE changes_with_blocked_state (
    id TEXT PRIMARY KEY,
    repository_common_directory TEXT NOT NULL,
    branch_ref TEXT NOT NULL,
    task_id TEXT UNIQUE,
    state TEXT NOT NULL CHECK (state IN ('open', 'blocked', 'closed')),
    close_reason TEXT CHECK (close_reason IS NULL OR close_reason IN ('completed', 'cancelled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    closed_at TEXT,
    base_ref TEXT,
    base_remote_url TEXT,
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
    FOREIGN KEY (task_id) REFERENCES tasks(id),
    UNIQUE (repository_common_directory, branch_ref),
    CHECK ((state IN ('open', 'blocked') AND close_reason IS NULL AND closed_at IS NULL) OR (state = 'closed' AND close_reason IS NOT NULL AND closed_at IS NOT NULL))
  )`);
  yield* sql.unsafe(`
    INSERT INTO changes_with_blocked_state (
      id, repository_common_directory, branch_ref, task_id, state, close_reason,
      created_at, updated_at, closed_at, base_ref, base_remote_url, starting_commit,
      worktree_path, acceptance_context, readiness, prepare_command,
      prepare_timeout_seconds, prepare_failure, publication_candidate_id,
      publication_validation_run_id, publication_owner, publication_repo,
      publication_base_branch, publication_remote_name, publication_head_branch,
      publication_expected_head_sha, publication_pr_number, publication_pr_url,
      no_change_candidate_id, no_change_validation_run_id, cleanup_state,
      cleanup_blocking_reason
    )
    SELECT
      id, repository_common_directory, branch_ref, task_id, state, close_reason,
      created_at, updated_at, closed_at, base_ref, base_remote_url, starting_commit,
      worktree_path, acceptance_context, readiness, prepare_command,
      prepare_timeout_seconds, prepare_failure, publication_candidate_id,
      publication_validation_run_id, publication_owner, publication_repo,
      publication_base_branch, publication_remote_name, publication_head_branch,
      publication_expected_head_sha, publication_pr_number, publication_pr_url,
      no_change_candidate_id, no_change_validation_run_id, cleanup_state,
      cleanup_blocking_reason
    FROM changes
  `);
  yield* sql.unsafe("DROP TABLE changes");
  yield* sql.unsafe("ALTER TABLE changes_with_blocked_state RENAME TO changes");
  yield* sql.unsafe(
    "CREATE UNIQUE INDEX changes_worktree_path_unique_idx ON changes (worktree_path) WHERE worktree_path IS NOT NULL",
  );
  yield* sql.unsafe(`
    INSERT INTO acceptance_context_versions (change_id, version, context, created_at)
    SELECT changes.id, 1, changes.acceptance_context, changes.created_at
    FROM changes
    WHERE changes.task_id IS NOT NULL
      AND changes.acceptance_context IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM acceptance_context_versions
        WHERE acceptance_context_versions.change_id = changes.id
          AND acceptance_context_versions.version = 1
      )
  `);

  const migratedTaskCounts = yield* sql<{
    readonly count: number | bigint;
  }>`SELECT COUNT(*) AS count FROM tasks`;
  const migratedChangeCounts = yield* sql<{
    readonly count: number | bigint;
  }>`SELECT COUNT(*) AS count FROM changes`;
  if (
    Number(migratedTaskCounts[0]?.count ?? -1) !== taskCount ||
    Number(migratedChangeCounts[0]?.count ?? -1) !== changeCount
  ) {
    return yield* Effect.fail(new Error("Lifecycle migration did not preserve parent rows"));
  }
  const foreignKeyFailures = yield* sql`PRAGMA foreign_key_check`;
  if (foreignKeyFailures.length > 0) {
    return yield* Effect.fail(new Error("Lifecycle migration did not preserve foreign keys"));
  }
});

const reviewerSessions = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(`
    CREATE TABLE reviewer_sessions (
      change_id TEXT PRIMARY KEY,
      identity TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      session_reference TEXT NOT NULL,
      last_candidate_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (change_id) REFERENCES changes(id)
    )
  `);
  yield* sql.unsafe(
    "CREATE INDEX reviewer_sessions_fingerprint_idx ON reviewer_sessions (fingerprint)",
  );
});

const specialistReviewerSessions = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(`
    CREATE TABLE reviewer_sessions_per_producer (
      change_id TEXT NOT NULL,
      producer TEXT NOT NULL,
      identity TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      session_reference TEXT NOT NULL,
      last_candidate_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (change_id, producer),
      FOREIGN KEY (change_id) REFERENCES changes(id)
    )
  `);
  yield* sql.unsafe(`
    INSERT INTO reviewer_sessions_per_producer
      (change_id, producer, identity, fingerprint, session_reference, last_candidate_id, updated_at)
    SELECT change_id, 'acceptance', identity, fingerprint, session_reference, last_candidate_id, updated_at
    FROM reviewer_sessions
  `);
  yield* sql.unsafe("DROP TABLE reviewer_sessions");
  yield* sql.unsafe("ALTER TABLE reviewer_sessions_per_producer RENAME TO reviewer_sessions");
  yield* sql.unsafe(
    "CREATE INDEX reviewer_sessions_fingerprint_idx ON reviewer_sessions (fingerprint)",
  );
});

const recoverPublishedRemoteBranchCleanup = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(
    "UPDATE changes SET cleanup_state = 'pending', cleanup_blocking_reason = NULL WHERE state = 'closed' AND close_reason = 'completed' AND publication_pr_number IS NOT NULL AND cleanup_state = 'complete'",
  );
});

export const migrateRepositoryState = Migrator.make({})({
  loader: Migrator.fromRecord({
    "0001_baseline": baseline,
    "0002_reviewer_sessions": reviewerSessions,
    "0003_implementation_decisions": implementationDecisions,
    "0004_implementation_blockers": implementationBlockers,
    "0005_acceptance_context_versions": acceptanceContextVersions,
    "0006_reconcile_implementation_blocker_storage": reconcileImplementationBlockerStorage,
    "0007_reviewer_sessions_per_producer": specialistReviewerSessions,
    "0008_recover_published_remote_branch_cleanup": recoverPublishedRemoteBranchCleanup,
  }),
});
