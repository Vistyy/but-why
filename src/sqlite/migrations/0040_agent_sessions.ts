import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

const migrationPrecondition = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    const openChanges = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM changes WHERE state = 'open'
    `;
    const activeTaskReviews = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM task_reviews WHERE state = 'running'
    `;
    const activeValidationRuns = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM candidate_validation_runs WHERE state = 'running'
    `;
    const taskReviewCleanup = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM task_reviews WHERE workspace_cleanup = 'failed'
    `;
    const validationCleanup = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM candidate_snapshot_workspaces WHERE cleanup_workspace = 'failed'
    `;
    const changeCleanup = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM changes WHERE cleanup_state = 'pending'
    `;
    const facts = {
      openChanges: openChanges[0]?.count ?? 0,
      activeTaskReviews: activeTaskReviews[0]?.count ?? 0,
      activeValidationRuns: activeValidationRuns[0]?.count ?? 0,
      pendingTaskReviewCleanup: taskReviewCleanup[0]?.count ?? 0,
      pendingValidationCleanup: validationCleanup[0]?.count ?? 0,
      pendingChangeCleanup: changeCleanup[0]?.count ?? 0,
    };
    if (Object.values(facts).some((count) => count !== 0)) {
      return yield* Effect.fail(
        new Error(
          `Agent Session migration requires settled prerelease state: ${JSON.stringify(facts)}`,
        ),
      );
    }
  });

const statements = [
  `
    ALTER TABLE tasks ADD COLUMN reviewer_configuration TEXT
  `,
  `
    ALTER TABLE changes ADD COLUMN reviewer_configuration TEXT
  `,
  `
    CREATE TABLE agent_sessions (
      id INTEGER PRIMARY KEY CHECK (id > 0 AND id <= 9007199254740991)
    )
  `,
  `
    ALTER TABLE tasks ADD COLUMN reviewer_agent_session_id INTEGER REFERENCES agent_sessions(id)
  `,
  `
    CREATE TABLE agent_continuations (
      id INTEGER PRIMARY KEY CHECK (id > 0 AND id <= 9007199254740991),
      agent_session_id INTEGER NOT NULL,
      harness TEXT NOT NULL,
      provider TEXT,
      model TEXT NOT NULL,
      thinking TEXT,
      transcript_path TEXT,
      unusable_reason TEXT,
      FOREIGN KEY (agent_session_id) REFERENCES agent_sessions(id)
    )
  `,
  `
    CREATE INDEX agent_continuations_session_id_idx
    ON agent_continuations (agent_session_id, id DESC)
  `,
  `
    CREATE TABLE agent_invocations (
      id INTEGER PRIMARY KEY CHECK (id > 0 AND id <= 9007199254740991),
      continuation_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      settled_at TEXT,
      settlement_kind TEXT,
      input_tokens INTEGER,
      cached_input_tokens INTEGER,
      output_tokens INTEGER,
      total_tokens INTEGER,
      FOREIGN KEY (continuation_id) REFERENCES agent_continuations(id),
      CHECK ((settled_at IS NULL AND settlement_kind IS NULL) OR
             (settled_at IS NOT NULL AND settlement_kind IS NOT NULL)),
      CHECK (settlement_kind IS NULL OR settlement_kind IN
             ('returned', 'launch_failed', 'failed', 'return_unknown')),
      CHECK ((input_tokens IS NULL AND cached_input_tokens IS NULL AND output_tokens IS NULL AND total_tokens IS NULL) OR
             (input_tokens IS NOT NULL AND cached_input_tokens IS NOT NULL AND output_tokens IS NOT NULL AND total_tokens IS NOT NULL)),
      CHECK (input_tokens IS NULL OR (input_tokens >= 0 AND input_tokens <= 9007199254740991)),
      CHECK (cached_input_tokens IS NULL OR (cached_input_tokens >= 0 AND cached_input_tokens <= 9007199254740991)),
      CHECK (output_tokens IS NULL OR (output_tokens >= 0 AND output_tokens <= 9007199254740991)),
      CHECK (total_tokens IS NULL OR (total_tokens >= 0 AND total_tokens <= 9007199254740991))
    )
  `,
  `
    CREATE INDEX agent_invocations_continuation_id_idx
    ON agent_invocations (continuation_id, id)
  `,
  `
    CREATE INDEX agent_invocations_unsettled_idx
    ON agent_invocations (continuation_id)
    WHERE settled_at IS NULL
  `,
  `
    CREATE TABLE task_review_agent_invocations (
      review_id TEXT NOT NULL,
      agent_invocation_id INTEGER NOT NULL,
      PRIMARY KEY (review_id, agent_invocation_id),
      FOREIGN KEY (review_id) REFERENCES task_reviews(id),
      FOREIGN KEY (agent_invocation_id) REFERENCES agent_invocations(id)
    )
  `,
  `
    CREATE TABLE validation_phase_agent_invocations (
      validation_run_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      producer TEXT NOT NULL,
      agent_invocation_id INTEGER NOT NULL,
      PRIMARY KEY (validation_run_id, phase, producer, agent_invocation_id),
      FOREIGN KEY (validation_run_id) REFERENCES candidate_validation_runs(id),
      FOREIGN KEY (agent_invocation_id) REFERENCES agent_invocations(id)
    )
  `,
  `
    CREATE UNIQUE INDEX validation_phase_agent_invocations_invocation_idx
    ON validation_phase_agent_invocations (agent_invocation_id)
  `,
  `
    CREATE UNIQUE INDEX task_review_agent_invocations_invocation_idx
    ON task_review_agent_invocations (agent_invocation_id)
  `,
  `
    CREATE TABLE change_agent_sessions (
      change_id TEXT NOT NULL,
      producer TEXT NOT NULL,
      agent_session_id INTEGER NOT NULL UNIQUE,
      PRIMARY KEY (change_id, producer),
      FOREIGN KEY (change_id) REFERENCES changes(id),
      FOREIGN KEY (agent_session_id) REFERENCES agent_sessions(id)
    )
  `,
  `
    CREATE UNIQUE INDEX tasks_reviewer_agent_session_idx
    ON tasks (reviewer_agent_session_id)
    WHERE reviewer_agent_session_id IS NOT NULL
  `,
] as const;

export const agentSessionsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* migrationPrecondition(sql);
  for (const statement of statements) yield* sql.unsafe(statement);
});
