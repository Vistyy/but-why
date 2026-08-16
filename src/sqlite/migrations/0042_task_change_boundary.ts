import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

const safeIntegerMaximum = 9_007_199_254_740_991;

const changeColumns = [
  "id",
  "repository_common_directory",
  "branch_ref",
  "state",
  "close_reason",
  "created_at",
  "updated_at",
  "closed_at",
  "base_ref",
  "base_remote_url",
  "starting_commit",
  "worktree_path",
  "acceptance_context",
  "prepare_command",
  "prepare_timeout_seconds",
  "prepare_failure",
  "publication_candidate_id",
  "publication_validation_run_id",
  "publication_owner",
  "publication_repo",
  "publication_base_branch",
  "publication_remote_name",
  "publication_head_branch",
  "publication_expected_head_sha",
  "publication_pr_number",
  "publication_pr_url",
  "cleanup_state",
  "cleanup_blocking_reason",
  "cancel_reason",
  "reviewer_configuration",
] as const;

const changeColumnList = changeColumns.join(", ");

const createChangesTable = `
  CREATE TABLE changes (
    id TEXT PRIMARY KEY,
    repository_common_directory TEXT NOT NULL,
    branch_ref TEXT NOT NULL,
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
      prepare_timeout_seconds IS NULL OR
      prepare_timeout_seconds BETWEEN 1 AND ${safeIntegerMaximum}
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
      publication_pr_number IS NULL OR
      publication_pr_number BETWEEN 1 AND ${safeIntegerMaximum}
    ),
    publication_pr_url TEXT,
    cleanup_state TEXT NOT NULL DEFAULT 'complete'
      CHECK (cleanup_state IN ('complete', 'pending')),
    cleanup_blocking_reason TEXT,
    cancel_reason TEXT,
    reviewer_configuration TEXT,
    FOREIGN KEY (publication_candidate_id) REFERENCES candidates(id),
    FOREIGN KEY (publication_validation_run_id) REFERENCES candidate_validation_runs(id),
    UNIQUE (repository_common_directory, branch_ref),
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
  ) STRICT`;

export const taskChangeBoundaryMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const invalidLinks = yield* sql<{ readonly id: string }>`
    SELECT id
    FROM changes
    WHERE task_id IS NOT NULL AND acceptance_context IS NULL
    LIMIT 1
  `;
  if (invalidLinks.length > 0) {
    return yield* Effect.fail(
      new Error(
        "Task and Change boundary migration found a linked Change without Acceptance Context",
      ),
    );
  }

  // Keep child foreign-key declarations pointed at the eventual `changes` table while the
  // parent is rebuilt. The migration runs in the Migrator transaction, so a failure rolls back
  // both the rebuilt table and the copied relationship rows.
  yield* sql.unsafe("PRAGMA legacy_alter_table = ON");
  yield* sql.unsafe("ALTER TABLE changes RENAME TO changes_before_task_change_boundary");
  yield* sql.unsafe(createChangesTable);
  yield* sql.unsafe(`
    INSERT INTO changes (${changeColumnList})
    SELECT ${changeColumnList}
    FROM changes_before_task_change_boundary
  `);
  yield* sql.unsafe(`
    CREATE TABLE task_change_links (
      task_id TEXT PRIMARY KEY,
      change_id TEXT NOT NULL UNIQUE,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (change_id) REFERENCES changes(id)
    ) STRICT
  `);
  yield* sql.unsafe(`
    INSERT INTO task_change_links (task_id, change_id)
    SELECT task_id, id
    FROM changes_before_task_change_boundary
    WHERE task_id IS NOT NULL
  `);
  yield* sql.unsafe(
    "CREATE INDEX task_change_links_change_id_idx ON task_change_links (change_id)",
  );
  yield* sql.unsafe("DROP TABLE changes_before_task_change_boundary");
  yield* sql.unsafe("PRAGMA legacy_alter_table = OFF");

  const remainingTaskColumn = yield* sql<{ readonly name: string }>`
    SELECT name FROM pragma_table_info('changes') WHERE name = 'task_id'
  `;
  if (remainingTaskColumn.length > 0) {
    return yield* Effect.fail(
      new Error("Task and Change boundary migration retained the retired Change task_id column"),
    );
  }
  const foreignKeyFailures = yield* sql`PRAGMA foreign_key_check`;
  if (foreignKeyFailures.length > 0) {
    return yield* Effect.fail(
      new Error("Task and Change boundary migration did not preserve foreign keys"),
    );
  }
});
