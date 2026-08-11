import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

const safeIntegerMaximum = 9_007_199_254_740_991;

const renameTables = [
  "tasks",
  "changes",
  "candidates",
  "candidate_validation_runs",
  "task_dependencies",
  "candidate_validation_workspace_setups",
  "candidate_validation_tooling_failures",
  "candidate_validation_rounds",
  "candidate_validation_findings",
  "candidate_validation_artifacts",
  "active_validation_runs",
  "implementation_decisions",
  "implementation_blockers",
  "reviewer_sessions",
  "reviewer_transcripts",
  "shared_state_identity",
] as const;

const dropLegacyTables = [
  "active_validation_runs",
  "candidate_validation_artifacts",
  "candidate_validation_findings",
  "candidate_validation_rounds",
  "candidate_validation_tooling_failures",
  "candidate_validation_workspace_setups",
  "reviewer_transcripts",
  "reviewer_sessions",
  "implementation_blockers",
  "implementation_decisions",
  "task_dependencies",
  "candidate_validation_runs",
  "candidates",
  "changes",
  "tasks",
  "shared_state_identity",
] as const;

export const enforceStableStorageConstraintsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe("PRAGMA defer_foreign_keys = ON");
  const sequenceRows = yield* sql<{
    readonly name: string;
    readonly seq: number;
  }>`SELECT name, seq FROM sqlite_sequence WHERE name IN (
    'candidate_validation_tooling_failures', 'implementation_decisions',
    'implementation_blockers'
  )`;

  for (const table of renameTables) {
    yield* sql.unsafe(`ALTER TABLE ${table} RENAME TO ${table}_before_stable_constraints`);
  }

  yield* sql.unsafe(`CREATE TABLE tasks (
    id TEXT NOT NULL UNIQUE,
    numeric_id INTEGER NOT NULL UNIQUE CHECK (numeric_id BETWEEN 1 AND ${safeIntegerMaximum}),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('new', 'todo', 'done', 'cancelled')),
    cancel_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK ((state = 'cancelled') = (cancel_reason IS NOT NULL))
  ) STRICT`);
  yield* sql.unsafe(`INSERT INTO tasks SELECT * FROM tasks_before_stable_constraints`);

  yield* sql.unsafe(`CREATE TABLE changes (
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
    worktree_path TEXT UNIQUE,
    acceptance_context TEXT,
    prepare_command TEXT,
    prepare_timeout_seconds INTEGER CHECK (
      prepare_timeout_seconds IS NULL OR prepare_timeout_seconds BETWEEN 1 AND ${safeIntegerMaximum}
    ),
    prepare_failure TEXT,
    publication_candidate_id TEXT,
    publication_validation_run_id TEXT,
    publication_owner TEXT,
    publication_repo TEXT,
    publication_base_branch TEXT,
    publication_remote_name TEXT,
    publication_head_branch TEXT,
    publication_expected_head_sha TEXT,
    publication_pr_number INTEGER CHECK (
      publication_pr_number IS NULL OR publication_pr_number BETWEEN 1 AND ${safeIntegerMaximum}
    ),
    publication_pr_url TEXT,
    cleanup_state TEXT NOT NULL DEFAULT 'complete' CHECK (cleanup_state IN ('complete', 'pending')),
    cleanup_blocking_reason TEXT,
    cancel_reason TEXT,
    FOREIGN KEY (task_id) REFERENCES tasks(id),
    FOREIGN KEY (publication_candidate_id) REFERENCES candidates(id),
    FOREIGN KEY (publication_validation_run_id) REFERENCES candidate_validation_runs(id),
    UNIQUE (repository_common_directory, branch_ref),
    CHECK ((task_id IS NULL) = (acceptance_context IS NULL)),
    CHECK (task_id IS NULL OR (
      base_ref IS NOT NULL AND base_remote_url IS NOT NULL AND
      starting_commit IS NOT NULL AND worktree_path IS NOT NULL
    )),
    CHECK ((prepare_command IS NULL) = (prepare_timeout_seconds IS NULL)),
    CHECK (prepare_failure IS NULL OR prepare_command IS NOT NULL),
    CHECK (
      (publication_candidate_id IS NULL AND publication_validation_run_id IS NULL AND
       publication_owner IS NULL AND publication_repo IS NULL AND
       publication_base_branch IS NULL AND publication_remote_name IS NULL AND
       publication_head_branch IS NULL AND publication_expected_head_sha IS NULL AND
       publication_pr_number IS NULL AND publication_pr_url IS NULL)
      OR
      (publication_candidate_id IS NOT NULL AND publication_validation_run_id IS NOT NULL AND
       publication_owner IS NOT NULL AND publication_repo IS NOT NULL AND
       publication_base_branch IS NOT NULL AND publication_remote_name IS NOT NULL AND
       publication_head_branch IS NOT NULL AND publication_expected_head_sha IS NOT NULL AND
       ((publication_pr_number IS NULL AND publication_pr_url IS NULL) OR
        (publication_pr_number IS NOT NULL AND publication_pr_url IS NOT NULL)))
    ),
    CHECK (
      (state = 'open' AND close_reason IS NULL AND closed_at IS NULL AND
       cleanup_state = 'complete' AND cleanup_blocking_reason IS NULL)
      OR
      (state = 'closed' AND close_reason IS NOT NULL AND closed_at IS NOT NULL AND
       (cleanup_state = 'pending' OR cleanup_blocking_reason IS NULL))
    ),
    CHECK (cancel_reason IS NULL OR (state = 'closed' AND close_reason = 'cancelled'))
  ) STRICT`);
  yield* sql.unsafe(`INSERT INTO changes SELECT * FROM changes_before_stable_constraints`);

  yield* sql.unsafe(`CREATE TABLE candidates (
    id TEXT PRIMARY KEY,
    change_id TEXT NOT NULL,
    change_base_sha TEXT NOT NULL,
    head_sha TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (change_id) REFERENCES changes(id),
    UNIQUE (change_id, change_base_sha, head_sha)
  ) STRICT`);
  yield* sql.unsafe(`INSERT INTO candidates SELECT * FROM candidates_before_stable_constraints`);

  yield* sql.unsafe(`CREATE TABLE candidate_validation_runs (
    id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL,
    policy_snapshot TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('running', 'complete')),
    outcome TEXT CHECK (outcome IS NULL OR outcome IN ('passed', 'blocked', 'tooling_failed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    implementation_decisions TEXT NOT NULL DEFAULT '[]',
    latest_resolved_blocker_id TEXT,
    FOREIGN KEY (candidate_id) REFERENCES candidates(id),
    FOREIGN KEY (latest_resolved_blocker_id) REFERENCES implementation_blockers(id),
    CHECK ((state = 'running' AND outcome IS NULL) OR
           (state = 'complete' AND outcome IS NOT NULL))
  ) STRICT`);
  yield* sql.unsafe(
    `INSERT INTO candidate_validation_runs SELECT * FROM candidate_validation_runs_before_stable_constraints`,
  );

  yield* sql.unsafe(`CREATE TABLE task_dependencies (
    dependent_task_id TEXT NOT NULL,
    prerequisite_task_id TEXT NOT NULL,
    PRIMARY KEY (dependent_task_id, prerequisite_task_id),
    FOREIGN KEY (dependent_task_id) REFERENCES tasks(id),
    FOREIGN KEY (prerequisite_task_id) REFERENCES tasks(id)
  ) STRICT`);
  yield* sql.unsafe(
    `INSERT INTO task_dependencies SELECT * FROM task_dependencies_before_stable_constraints`,
  );

  yield* sql.unsafe(`CREATE TABLE candidate_validation_workspace_setups (
    validation_run_id TEXT PRIMARY KEY,
    temp_ref_name TEXT NOT NULL,
    submitted_sha TEXT NOT NULL,
    worktree_head TEXT NOT NULL,
    cleanup_worktree TEXT NOT NULL CHECK (cleanup_worktree IN ('removed', 'not_created', 'failed')),
    cleanup_temp_ref TEXT NOT NULL CHECK (cleanup_temp_ref IN ('removed', 'not_created', 'failed')),
    created_at TEXT NOT NULL,
    worktree_path TEXT,
    FOREIGN KEY (validation_run_id) REFERENCES candidate_validation_runs(id)
  ) STRICT`);
  yield* sql.unsafe(
    `INSERT INTO candidate_validation_workspace_setups SELECT * FROM candidate_validation_workspace_setups_before_stable_constraints`,
  );

  yield* sql.unsafe(`CREATE TABLE candidate_validation_tooling_failures (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT CHECK (sequence BETWEEN 1 AND ${safeIntegerMaximum}),
    validation_run_id TEXT NOT NULL,
    error_kind TEXT NOT NULL CHECK (error_kind IN (
      'validation_workspace_setup_failed', 'infrastructure_tooling_failed',
      'git_tooling_failed', 'reviewer_process_execution_failed',
      'prepare_command_execution_tooling_failed', 'check_command_execution_tooling_failed',
      'reviewer_output_contract_failed', 'token_usage_contract_failed'
    )),
    operation_name TEXT NOT NULL,
    error_message TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (validation_run_id) REFERENCES candidate_validation_runs(id)
  ) STRICT`);
  yield* sql.unsafe(`
    UPDATE candidate_validation_tooling_failures_before_stable_constraints
    SET error_kind = 'infrastructure_tooling_failed'
    WHERE error_kind = 'interrupted_submission'
  `);
  yield* sql.unsafe(
    `INSERT INTO candidate_validation_tooling_failures SELECT * FROM candidate_validation_tooling_failures_before_stable_constraints`,
  );

  yield* sql.unsafe(`CREATE TABLE candidate_validation_rounds (
    validation_run_id TEXT NOT NULL,
    phase TEXT NOT NULL CHECK (phase IN (
      'prepare', 'checks', 'acceptance_review', 'specialist_review'
    )),
    producer TEXT NOT NULL,
    round_number INTEGER NOT NULL CHECK (round_number BETWEEN 1 AND ${safeIntegerMaximum}),
    status TEXT NOT NULL CHECK (status IN ('passed', 'failed')),
    created_at TEXT NOT NULL,
    PRIMARY KEY (validation_run_id, phase, producer, round_number),
    FOREIGN KEY (validation_run_id) REFERENCES candidate_validation_runs(id),
    UNIQUE (validation_run_id, phase, producer),
    CHECK ((phase = 'prepare' AND producer = 'prepare') OR
           (phase = 'acceptance_review' AND producer = 'acceptance') OR
           phase IN ('checks', 'specialist_review'))
  ) STRICT`);
  yield* sql.unsafe(
    `INSERT INTO candidate_validation_rounds SELECT * FROM candidate_validation_rounds_before_stable_constraints`,
  );

  yield* sql.unsafe(`CREATE TABLE candidate_validation_findings (
    id TEXT PRIMARY KEY,
    validation_run_id TEXT NOT NULL,
    phase TEXT NOT NULL CHECK (phase IN (
      'prepare', 'checks', 'acceptance_review', 'specialist_review'
    )),
    producer TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    evidence TEXT NOT NULL,
    files TEXT NOT NULL,
    artifact_refs TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (validation_run_id, phase, producer)
      REFERENCES candidate_validation_rounds(validation_run_id, phase, producer),
    CHECK ((phase = 'prepare' AND producer = 'prepare') OR
           (phase = 'acceptance_review' AND producer = 'acceptance') OR
           phase IN ('checks', 'specialist_review'))
  ) STRICT`);
  yield* sql.unsafe(
    `INSERT INTO candidate_validation_findings SELECT * FROM candidate_validation_findings_before_stable_constraints`,
  );

  yield* sql.unsafe(`CREATE TABLE candidate_validation_artifacts (
    ref TEXT PRIMARY KEY,
    validation_run_id TEXT NOT NULL,
    phase TEXT NOT NULL CHECK (phase IN (
      'prepare', 'checks', 'acceptance_review', 'specialist_review'
    )),
    producer TEXT NOT NULL,
    path TEXT NOT NULL,
    original_bytes INTEGER NOT NULL DEFAULT 0 CHECK (
      original_bytes BETWEEN 0 AND ${safeIntegerMaximum}
    ),
    stored_bytes INTEGER NOT NULL DEFAULT 0 CHECK (
      stored_bytes BETWEEN 0 AND ${safeIntegerMaximum}
    ),
    truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
    created_at TEXT NOT NULL,
    FOREIGN KEY (validation_run_id, phase, producer)
      REFERENCES candidate_validation_rounds(validation_run_id, phase, producer),
    CHECK ((phase = 'prepare' AND producer = 'prepare') OR
           (phase = 'acceptance_review' AND producer = 'acceptance') OR
           phase IN ('checks', 'specialist_review')),
    CHECK (stored_bytes <= original_bytes),
    CHECK (truncated = (stored_bytes < original_bytes))
  ) STRICT`);
  yield* sql.unsafe(
    `INSERT INTO candidate_validation_artifacts SELECT * FROM candidate_validation_artifacts_before_stable_constraints`,
  );

  yield* sql.unsafe(`CREATE TABLE active_validation_runs (
    change_id TEXT PRIMARY KEY,
    validation_run_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    FOREIGN KEY (change_id) REFERENCES changes(id),
    FOREIGN KEY (validation_run_id) REFERENCES candidate_validation_runs(id)
  ) STRICT`);
  yield* sql.unsafe(
    `INSERT INTO active_validation_runs SELECT * FROM active_validation_runs_before_stable_constraints`,
  );

  yield* sql.unsafe(`CREATE TABLE implementation_decisions (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT CHECK (sequence BETWEEN 1 AND ${safeIntegerMaximum}),
    id TEXT NOT NULL UNIQUE,
    change_id TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    choice TEXT NOT NULL,
    rationale TEXT NOT NULL,
    FOREIGN KEY (change_id) REFERENCES changes(id)
  ) STRICT`);
  yield* sql.unsafe(
    `INSERT INTO implementation_decisions SELECT * FROM implementation_decisions_before_stable_constraints`,
  );

  yield* sql.unsafe(`CREATE TABLE implementation_blockers (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT CHECK (sequence BETWEEN 1 AND ${safeIntegerMaximum}),
    id TEXT NOT NULL UNIQUE,
    change_id TEXT NOT NULL,
    reported_at TEXT NOT NULL,
    content TEXT NOT NULL,
    resolved_at TEXT,
    resolution_id TEXT UNIQUE,
    resolution_recorded_at TEXT,
    resolution_content TEXT,
    FOREIGN KEY (change_id) REFERENCES changes(id),
    CHECK (
      (resolved_at IS NULL AND resolution_id IS NULL AND
       resolution_recorded_at IS NULL AND resolution_content IS NULL)
      OR
      (resolved_at IS NOT NULL AND resolution_id IS NOT NULL AND
       resolution_recorded_at IS NOT NULL AND resolution_content IS NOT NULL)
    )
  ) STRICT`);
  yield* sql.unsafe(
    `INSERT INTO implementation_blockers SELECT * FROM implementation_blockers_before_stable_constraints`,
  );

  yield* sql.unsafe(`CREATE TABLE reviewer_sessions (
    change_id TEXT NOT NULL,
    producer TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    session_reference TEXT NOT NULL,
    PRIMARY KEY (change_id, producer),
    FOREIGN KEY (change_id) REFERENCES changes(id)
  ) STRICT`);
  yield* sql.unsafe(
    `INSERT INTO reviewer_sessions SELECT * FROM reviewer_sessions_before_stable_constraints`,
  );

  yield* sql.unsafe(`CREATE TABLE reviewer_transcripts (
    change_id TEXT NOT NULL,
    producer TEXT NOT NULL,
    pi_session_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    PRIMARY KEY (change_id, producer, file_path),
    FOREIGN KEY (change_id) REFERENCES changes(id)
  ) STRICT`);
  yield* sql.unsafe(
    `INSERT INTO reviewer_transcripts SELECT * FROM reviewer_transcripts_before_stable_constraints`,
  );

  yield* sql.unsafe(`CREATE TABLE shared_state_identity (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    common_directory TEXT NOT NULL
  ) STRICT`);
  yield* sql.unsafe(
    `INSERT INTO shared_state_identity SELECT * FROM shared_state_identity_before_stable_constraints`,
  );

  const foreignKeyFailures = yield* sql`PRAGMA foreign_key_check`;
  if (foreignKeyFailures.length > 0) {
    return yield* Effect.fail(
      new Error("Stable storage constraint migration found invalid foreign keys"),
    );
  }

  for (const table of dropLegacyTables) {
    yield* sql.unsafe(`DROP TABLE ${table}_before_stable_constraints`);
  }
  for (const { name, seq } of sequenceRows) {
    yield* sql`UPDATE sqlite_sequence SET seq = max(seq, ${seq}) WHERE name = ${name}`;
  }

  yield* sql.unsafe(
    "CREATE INDEX task_dependencies_prerequisite_idx ON task_dependencies (prerequisite_task_id, dependent_task_id)",
  );
  yield* sql.unsafe(
    "CREATE INDEX candidates_change_id_created_at_idx ON candidates (change_id, created_at)",
  );
  yield* sql.unsafe(`CREATE UNIQUE INDEX candidate_validation_runs_reuse_idx
    ON candidate_validation_runs (
      candidate_id, policy_snapshot, implementation_decisions, latest_resolved_blocker_id
    )
    WHERE outcome = 'passed' AND latest_resolved_blocker_id IS NOT NULL`);
  yield* sql.unsafe(`CREATE UNIQUE INDEX candidate_validation_runs_reuse_without_blocker_idx
    ON candidate_validation_runs (candidate_id, policy_snapshot, implementation_decisions)
    WHERE outcome = 'passed' AND latest_resolved_blocker_id IS NULL`);
  yield* sql.unsafe(
    "CREATE INDEX implementation_decisions_change_sequence_idx ON implementation_decisions (change_id, sequence)",
  );
  yield* sql.unsafe(`CREATE UNIQUE INDEX implementation_blockers_active_idx
    ON implementation_blockers (change_id) WHERE resolved_at IS NULL`);
});
