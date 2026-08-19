import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

const safeIntegerMaximum = 9_007_199_254_740_991;

const baselineStatements = [
  `
    CREATE TABLE shared_state_identity (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      common_directory TEXT NOT NULL,
      id_prefix TEXT NOT NULL
    ) STRICT
  `,
  `
    CREATE TABLE agent_sessions (
      id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND ${safeIntegerMaximum})
    ) STRICT
  `,
  `
    CREATE TABLE agent_continuations (
      id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND ${safeIntegerMaximum}),
      agent_session_id INTEGER NOT NULL REFERENCES agent_sessions(id),
      harness TEXT NOT NULL,
      provider TEXT,
      model TEXT NOT NULL,
      thinking TEXT,
      transcript_path TEXT,
      unusable_reason TEXT
    ) STRICT
  `,
  `CREATE INDEX agent_continuations_session_id_idx
    ON agent_continuations (agent_session_id, id DESC)`,
  `
    CREATE TABLE agent_invocations (
      id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND ${safeIntegerMaximum}),
      continuation_id INTEGER NOT NULL REFERENCES agent_continuations(id),
      created_at TEXT NOT NULL,
      settled_at TEXT,
      settlement_kind TEXT,
      input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens BETWEEN 0 AND ${safeIntegerMaximum}),
      cached_input_tokens INTEGER CHECK (cached_input_tokens IS NULL OR cached_input_tokens BETWEEN 0 AND ${safeIntegerMaximum}),
      cache_write_tokens INTEGER CHECK (cache_write_tokens IS NULL OR cache_write_tokens BETWEEN 0 AND ${safeIntegerMaximum}),
      output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens BETWEEN 0 AND ${safeIntegerMaximum}),
      total_tokens INTEGER CHECK (total_tokens IS NULL OR total_tokens BETWEEN 0 AND ${safeIntegerMaximum}),
      CHECK ((settled_at IS NULL) = (settlement_kind IS NULL)),
      CHECK ((input_tokens IS NULL AND cached_input_tokens IS NULL AND cache_write_tokens IS NULL AND output_tokens IS NULL AND total_tokens IS NULL) OR
             (input_tokens IS NOT NULL AND cached_input_tokens IS NOT NULL AND cache_write_tokens IS NOT NULL AND output_tokens IS NOT NULL AND total_tokens IS NOT NULL))
    ) STRICT
  `,
  `CREATE INDEX agent_invocations_continuation_id_idx
    ON agent_invocations (continuation_id, id)`,
  `CREATE INDEX agent_invocations_unsettled_idx
    ON agent_invocations (continuation_id) WHERE settled_at IS NULL`,
  `
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND ${safeIntegerMaximum}),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('new', 'todo', 'done', 'cancelled')),
      cancel_reason TEXT,
      reviewer_configuration TEXT,
      reviewer_agent_session_id INTEGER UNIQUE REFERENCES agent_sessions(id),
      CHECK ((state = 'cancelled') = (cancel_reason IS NOT NULL)),
      CHECK ((reviewer_configuration IS NULL) = (reviewer_agent_session_id IS NULL))
    ) STRICT
  `,
  `CREATE INDEX tasks_state_id_idx ON tasks (state, id)`,
  `
    CREATE TABLE task_dependencies (
      dependent_task_id INTEGER NOT NULL REFERENCES tasks(id),
      prerequisite_task_id INTEGER NOT NULL REFERENCES tasks(id),
      PRIMARY KEY (dependent_task_id, prerequisite_task_id)
    ) STRICT
  `,
  `CREATE INDEX task_dependencies_prerequisite_idx
    ON task_dependencies (prerequisite_task_id, dependent_task_id)`,
  `
    CREATE TABLE task_reviews (
      id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND ${safeIntegerMaximum}),
      task_id INTEGER NOT NULL REFERENCES tasks(id),
      proposal TEXT NOT NULL,
      dependency_evidence TEXT NOT NULL,
      base_ref TEXT NOT NULL,
      base_commit TEXT NOT NULL,
      outcome TEXT CHECK (outcome IS NULL OR outcome IN ('passed', 'blocked', 'tooling_failed')),
      findings TEXT NOT NULL,
      tooling_failure TEXT,
      cleanup_pending INTEGER NOT NULL CHECK (cleanup_pending IN (0, 1)),
      cleanup_blocking_reason TEXT
    ) STRICT
  `,
  `CREATE INDEX task_reviews_task_id_idx ON task_reviews (task_id, id DESC)`,
  `CREATE UNIQUE INDEX task_reviews_active_idx
    ON task_reviews (task_id) WHERE outcome IS NULL`,
  `
    CREATE TABLE task_review_agent_invocations (
      task_review_id INTEGER NOT NULL REFERENCES task_reviews(id),
      agent_invocation_id INTEGER NOT NULL UNIQUE REFERENCES agent_invocations(id),
      PRIMARY KEY (task_review_id, agent_invocation_id)
    ) STRICT
  `,
  `
    CREATE TABLE changes (
      id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND ${safeIntegerMaximum}),
      branch_ref TEXT NOT NULL UNIQUE,
      base_ref TEXT NOT NULL,
      base_remote_url TEXT NOT NULL,
      worktree_path TEXT NOT NULL UNIQUE,
      initial_acceptance_context TEXT,
      reviewer_configuration TEXT NOT NULL,
      prepare_definition TEXT,
      checks_definition TEXT NOT NULL,
      prepare_failure TEXT,
      close_reason TEXT CHECK (close_reason IS NULL OR close_reason IN ('completed', 'cancelled')),
      cancel_reason TEXT,
      cleanup_pending INTEGER NOT NULL CHECK (cleanup_pending IN (0, 1)),
      cleanup_blocking_reason TEXT,
      CHECK ((close_reason IS NULL AND cancel_reason IS NULL) OR
             (close_reason IS NOT NULL AND (
               (close_reason = 'completed' AND cancel_reason IS NULL) OR
               (close_reason = 'cancelled' AND cancel_reason IS NOT NULL))))
    ) STRICT
  `,
  `CREATE INDEX changes_close_reason_id_idx ON changes (close_reason, id)`,
  `
    CREATE TABLE task_change_links (
      task_id INTEGER PRIMARY KEY REFERENCES tasks(id),
      change_id INTEGER NOT NULL UNIQUE REFERENCES changes(id)
    ) STRICT
  `,
  `
    CREATE TABLE implementation_decisions (
      id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND ${safeIntegerMaximum}),
      change_id INTEGER NOT NULL REFERENCES changes(id),
      choice TEXT NOT NULL,
      rationale TEXT NOT NULL
    ) STRICT
  `,
  `CREATE INDEX implementation_decisions_change_id_idx
    ON implementation_decisions (change_id, id)`,
  `
    CREATE TABLE implementation_blockers (
      id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND ${safeIntegerMaximum}),
      change_id INTEGER NOT NULL REFERENCES changes(id),
      content TEXT NOT NULL,
      resolution_content TEXT
    ) STRICT
  `,
  `CREATE INDEX implementation_blockers_change_id_idx
    ON implementation_blockers (change_id, id)`,
  `CREATE UNIQUE INDEX implementation_blockers_unresolved_idx
    ON implementation_blockers (change_id) WHERE resolution_content IS NULL`,
  `
    CREATE TABLE candidates (
      id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND ${safeIntegerMaximum}),
      change_id INTEGER NOT NULL REFERENCES changes(id),
      base_commit TEXT NOT NULL,
      head_commit TEXT NOT NULL
    ) STRICT
  `,
  `CREATE INDEX candidates_change_id_idx ON candidates (change_id, id DESC)`,
  `
    CREATE TABLE validation_runs (
      id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND ${safeIntegerMaximum}),
      candidate_id INTEGER NOT NULL REFERENCES candidates(id),
      validation_input_snapshot TEXT NOT NULL,
      highest_decision_id INTEGER REFERENCES implementation_decisions(id),
      highest_blocker_id INTEGER REFERENCES implementation_blockers(id),
      outcome TEXT CHECK (outcome IS NULL OR outcome IN ('passed', 'blocked', 'tooling_failed')),
      run_tooling_failure TEXT,
      cleanup_pending INTEGER NOT NULL CHECK (cleanup_pending IN (0, 1)),
      cleanup_blocking_reason TEXT
    ) STRICT
  `,
  `CREATE INDEX validation_runs_candidate_id_idx
    ON validation_runs (candidate_id, id DESC)`,
  `CREATE INDEX validation_runs_active_idx
    ON validation_runs (candidate_id, id DESC) WHERE outcome IS NULL`,
  `CREATE INDEX validation_runs_passed_idx
    ON validation_runs (candidate_id, id DESC) WHERE outcome = 'passed'`,
  `
    CREATE TABLE validation_phase_results (
      validation_run_id INTEGER NOT NULL REFERENCES validation_runs(id),
      phase TEXT NOT NULL,
      producer TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK (outcome IN ('passed', 'failed')),
      findings TEXT NOT NULL,
      artifacts TEXT NOT NULL,
      tooling_failure TEXT,
      PRIMARY KEY (validation_run_id, phase, producer)
    ) STRICT
  `,
  `
    CREATE TABLE validation_phase_agent_invocations (
      validation_run_id INTEGER NOT NULL REFERENCES validation_runs(id),
      phase TEXT NOT NULL,
      producer TEXT NOT NULL,
      agent_invocation_id INTEGER NOT NULL UNIQUE REFERENCES agent_invocations(id),
      PRIMARY KEY (validation_run_id, phase, producer, agent_invocation_id)
    ) STRICT
  `,
  `
    CREATE TABLE change_agent_sessions (
      change_id INTEGER NOT NULL REFERENCES changes(id),
      producer TEXT NOT NULL,
      agent_session_id INTEGER NOT NULL UNIQUE REFERENCES agent_sessions(id),
      PRIMARY KEY (change_id, producer)
    ) STRICT
  `,
  `
    CREATE TABLE github_publications (
      change_id INTEGER PRIMARY KEY REFERENCES changes(id),
      candidate_id INTEGER NOT NULL REFERENCES candidates(id),
      validation_run_id INTEGER NOT NULL REFERENCES validation_runs(id),
      pull_request_number INTEGER CHECK (pull_request_number IS NULL OR pull_request_number BETWEEN 1 AND ${safeIntegerMaximum})
    ) STRICT
  `,
] as const;

export const baselineMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of baselineStatements) yield* sql.unsafe(statement);
});
