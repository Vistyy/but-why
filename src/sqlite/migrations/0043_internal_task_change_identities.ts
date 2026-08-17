import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import {
  PredecessorReconciliationRequiredError,
  RepositoryIdPrefixConflict,
} from "../../contracts/repositoryStorageError.js";

const safeIntegerMaximum = 9_007_199_254_740_991;

const rebuiltTables = [
  "active_validation_runs",
  "candidate_snapshot_workspaces",
  "candidate_validation_artifacts",
  "candidate_validation_findings",
  "candidate_validation_rounds",
  "candidate_validation_runs",
  "candidate_validation_tooling_failures",
  "candidates",
  "change_agent_sessions",
  "current_candidates",
  "implementation_blockers",
  "implementation_decisions",
  "reviewer_sessions",
  "reviewer_transcripts",
  "task_change_links",
  "task_dependencies",
  "task_review_agent_invocations",
  "task_review_executions",
  "task_review_findings",
  "task_review_transcript_observations",
  "task_reviewer_sessions",
  "task_reviewer_transcripts",
  "task_reviews",
  "validation_phase_agent_invocations",
] as const;

const migrationPrecondition = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    const facts = {
      openChanges:
        (yield* sql<{
          readonly count: number;
        }>`SELECT COUNT(*) AS count FROM changes WHERE state = 'open'`)[0]?.count ?? 0,
      activeTaskReviews:
        (yield* sql<{
          readonly count: number;
        }>`SELECT COUNT(*) AS count FROM task_reviews WHERE state = 'running'`)[0]?.count ?? 0,
      activeValidationRuns:
        (yield* sql<{
          readonly count: number;
        }>`SELECT COUNT(*) AS count FROM candidate_validation_runs WHERE state = 'running'`)[0]
          ?.count ?? 0,
      unsettledAgentInvocations:
        (yield* sql<{
          readonly count: number;
        }>`SELECT COUNT(*) AS count FROM agent_invocations WHERE settled_at IS NULL`)[0]?.count ??
        0,
      pendingTaskReviewCleanup:
        (yield* sql<{
          readonly count: number;
        }>`SELECT COUNT(*) AS count FROM task_reviews WHERE workspace_cleanup = 'failed'`)[0]
          ?.count ?? 0,
      pendingValidationCleanup:
        (yield* sql<{
          readonly count: number;
        }>`SELECT COUNT(*) AS count FROM candidate_snapshot_workspaces WHERE cleanup_workspace = 'failed'`)[0]
          ?.count ?? 0,
      pendingChangeCleanup:
        (yield* sql<{
          readonly count: number;
        }>`SELECT COUNT(*) AS count FROM changes WHERE cleanup_state = 'pending'`)[0]?.count ?? 0,
    };
    if (Object.values(facts).some((count) => count !== 0)) {
      return yield* new PredecessorReconciliationRequiredError({ blocked: facts });
    }
  });

const quote = (name: string): string => `"${name.replaceAll('"', '""')}"`;

const rewrittenCreateSql = (source: string, table: string): string => {
  const renamed = source.replace(
    new RegExp(`^(CREATE TABLE )(?:"${table}"|${table})`, "u"),
    `$1${quote(table)}`,
  );
  return renamed
    .replace(/\btask_id TEXT\b/gu, "task_id INTEGER")
    .replace(/\bdependent_task_id TEXT\b/gu, "dependent_task_id INTEGER")
    .replace(/\bprerequisite_task_id TEXT\b/gu, "prerequisite_task_id INTEGER")
    .replace(/\bchange_id TEXT\b/gu, "change_id INTEGER");
};

const copyRebuiltTable = (sql: SqlClient.SqlClient, table: string, columns: readonly string[]) => {
  const source = `${table}_before_internal_identities`;
  const selections = columns.map((column) => {
    if (
      column === "task_id" ||
      column === "dependent_task_id" ||
      column === "prerequisite_task_id"
    ) {
      return `(SELECT numeric_id FROM tasks_before_internal_identities AS task WHERE task.id = source.${quote(column)})`;
    }
    if (column === "change_id") {
      return `(SELECT internal_id FROM change_identity_map AS identity WHERE identity.public_id = source.change_id)`;
    }
    return `source.${quote(column)}`;
  });
  return sql.unsafe(
    `INSERT INTO ${quote(table)} (${columns.map(quote).join(", ")}) ` +
      `SELECT ${selections.join(", ")} FROM ${quote(source)} AS source`,
  );
};

export const internalTaskChangeIdentitiesMigration = (idPrefix: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* migrationPrecondition(sql);

    const conflictingTasks = yield* sql<{ readonly id: string; readonly numericId: number }>`
      SELECT id, numeric_id AS numericId FROM tasks
      WHERE id <> ${idPrefix} || '-' || numeric_id
      LIMIT 1
    `;
    const conflictingTask = conflictingTasks[0];
    if (conflictingTask !== undefined) {
      const separator = conflictingTask.id.lastIndexOf("-");
      const storedIdPrefix =
        separator < 1 ? conflictingTask.id : conflictingTask.id.slice(0, separator);
      return yield* Effect.fail(
        new RepositoryIdPrefixConflict({
          configuredIdPrefix: idPrefix,
          storedIdPrefix,
        }),
      );
    }

    const tableSchemas = yield* sql<{ readonly name: string; readonly sql: string }>`
      SELECT name, sql FROM sqlite_schema
      WHERE type = 'table' AND name IN ${sql.in(rebuiltTables)}
    `;
    const indexSchemas = yield* sql<{ readonly sql: string }>`
      SELECT sql FROM sqlite_schema
      WHERE type = 'index' AND sql IS NOT NULL AND tbl_name IN ${sql.in(rebuiltTables)}
    `;
    const columnsByTable = new Map<string, readonly string[]>();
    for (const table of rebuiltTables) {
      const columns = yield* sql.unsafe<{ readonly name: string }>(
        `PRAGMA table_info(${quote(table)})`,
      );
      columnsByTable.set(
        table,
        columns.map((column) => column.name),
      );
    }

    yield* sql.unsafe("PRAGMA legacy_alter_table = ON");
    for (const table of [...rebuiltTables].reverse()) {
      yield* sql.unsafe(
        `ALTER TABLE ${quote(table)} RENAME TO ${quote(`${table}_before_internal_identities`)}`,
      );
    }
    yield* sql.unsafe("ALTER TABLE changes RENAME TO changes_before_internal_identities");
    yield* sql.unsafe("ALTER TABLE tasks RENAME TO tasks_before_internal_identities");
    yield* sql.unsafe(
      "ALTER TABLE shared_state_identity RENAME TO shared_state_identity_before_internal_identities",
    );

    yield* sql.unsafe(
      `
      CREATE TEMP TABLE change_identity_map (
        public_id TEXT PRIMARY KEY,
        internal_id INTEGER NOT NULL UNIQUE
      ) STRICT
    `.trim(),
    );
    yield* sql.unsafe(`
      INSERT INTO change_identity_map (public_id, internal_id)
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id)
      FROM changes_before_internal_identities
    `);

    yield* sql.unsafe(
      `
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND ${safeIntegerMaximum}),
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('new', 'todo', 'done', 'cancelled')),
        cancel_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        reviewer_configuration TEXT,
        reviewer_agent_session_id INTEGER REFERENCES agent_sessions(id),
        CHECK ((state = 'cancelled') = (cancel_reason IS NOT NULL))
      ) STRICT
    `.trim(),
    );
    yield* sql.unsafe(`
      INSERT INTO tasks (
        id, title, description, state, cancel_reason, created_at, updated_at,
        reviewer_configuration, reviewer_agent_session_id
      )
      SELECT numeric_id, title, description, state, cancel_reason, created_at, updated_at,
        reviewer_configuration, reviewer_agent_session_id
      FROM tasks_before_internal_identities
    `);

    yield* sql.unsafe(
      `
      CREATE TABLE changes (
        id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND ${safeIntegerMaximum}),
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
        prepare_timeout_seconds INTEGER CHECK (prepare_timeout_seconds IS NULL OR prepare_timeout_seconds BETWEEN 1 AND ${safeIntegerMaximum}),
        prepare_failure TEXT,
        publication_candidate_id TEXT,
        publication_validation_run_id TEXT,
        publication_owner TEXT,
        publication_repo TEXT,
        publication_base_branch TEXT,
        publication_remote_name TEXT,
        publication_head_branch TEXT,
        publication_expected_head_sha TEXT,
        publication_pr_number INTEGER CHECK (publication_pr_number IS NULL OR publication_pr_number BETWEEN 1 AND ${safeIntegerMaximum}),
        publication_pr_url TEXT,
        cleanup_state TEXT NOT NULL DEFAULT 'complete' CHECK (cleanup_state IN ('complete', 'pending')),
        cleanup_blocking_reason TEXT,
        cancel_reason TEXT,
        reviewer_configuration TEXT,
        FOREIGN KEY (publication_candidate_id) REFERENCES candidates(id),
        FOREIGN KEY (publication_validation_run_id) REFERENCES candidate_validation_runs(id),
        UNIQUE (repository_common_directory, branch_ref),
        CHECK ((prepare_command IS NULL) = (prepare_timeout_seconds IS NULL)),
        CHECK (prepare_failure IS NULL OR prepare_command IS NOT NULL),
        CHECK ((publication_candidate_id IS NULL AND publication_validation_run_id IS NULL AND publication_owner IS NULL AND publication_repo IS NULL AND publication_base_branch IS NULL AND publication_remote_name IS NULL AND publication_head_branch IS NULL AND publication_expected_head_sha IS NULL AND publication_pr_number IS NULL AND publication_pr_url IS NULL) OR (publication_candidate_id IS NOT NULL AND publication_validation_run_id IS NOT NULL AND publication_owner IS NOT NULL AND publication_repo IS NOT NULL AND publication_base_branch IS NOT NULL AND publication_remote_name IS NOT NULL AND publication_head_branch IS NOT NULL AND publication_expected_head_sha IS NOT NULL AND ((publication_pr_number IS NULL AND publication_pr_url IS NULL) OR (publication_pr_number IS NOT NULL AND publication_pr_url IS NOT NULL)))),
        CHECK ((state = 'open' AND close_reason IS NULL AND closed_at IS NULL AND cleanup_state = 'complete' AND cleanup_blocking_reason IS NULL) OR (state = 'closed' AND close_reason IS NOT NULL AND closed_at IS NOT NULL AND (cleanup_state = 'pending' OR cleanup_blocking_reason IS NULL))),
        CHECK (cancel_reason IS NULL OR (state = 'closed' AND close_reason = 'cancelled'))
      ) STRICT
    `.trim(),
    );
    yield* sql.unsafe(`
      INSERT INTO changes (
        id, repository_common_directory, branch_ref, state, close_reason, created_at, updated_at,
        closed_at, base_ref, base_remote_url, starting_commit, worktree_path, acceptance_context,
        prepare_command, prepare_timeout_seconds, prepare_failure, publication_candidate_id,
        publication_validation_run_id, publication_owner, publication_repo, publication_base_branch,
        publication_remote_name, publication_head_branch, publication_expected_head_sha,
        publication_pr_number, publication_pr_url, cleanup_state, cleanup_blocking_reason,
        cancel_reason, reviewer_configuration
      )
      SELECT identity.internal_id, source.repository_common_directory, source.branch_ref, source.state,
        source.close_reason, source.created_at, source.updated_at, source.closed_at, source.base_ref,
        source.base_remote_url, source.starting_commit, source.worktree_path, source.acceptance_context,
        source.prepare_command, source.prepare_timeout_seconds, source.prepare_failure,
        source.publication_candidate_id, source.publication_validation_run_id, source.publication_owner,
        source.publication_repo, source.publication_base_branch, source.publication_remote_name,
        source.publication_head_branch, source.publication_expected_head_sha, source.publication_pr_number,
        source.publication_pr_url, source.cleanup_state, source.cleanup_blocking_reason, source.cancel_reason,
        source.reviewer_configuration
      FROM changes_before_internal_identities AS source
      JOIN change_identity_map AS identity ON identity.public_id = source.id
    `);

    for (const table of rebuiltTables) {
      const schema = tableSchemas.find((candidate) => candidate.name === table)?.sql;
      const columns = columnsByTable.get(table);
      if (schema === undefined || columns === undefined) {
        return yield* Effect.fail(
          new Error(`Internal identity migration could not inspect ${table}`),
        );
      }
      yield* sql.unsafe(rewrittenCreateSql(schema, table));
      yield* copyRebuiltTable(sql, table, columns);
    }

    for (const table of rebuiltTables) {
      yield* sql.unsafe(`DROP TABLE ${quote(`${table}_before_internal_identities`)}`);
    }
    yield* sql.unsafe("DROP TABLE changes_before_internal_identities");
    yield* sql.unsafe("DROP TABLE tasks_before_internal_identities");
    yield* sql.unsafe(`
      CREATE UNIQUE INDEX tasks_reviewer_agent_session_idx
      ON tasks (reviewer_agent_session_id)
      WHERE reviewer_agent_session_id IS NOT NULL
    `);
    for (const index of indexSchemas) yield* sql.unsafe(index.sql);

    yield* sql.unsafe(
      `
      CREATE TABLE shared_state_identity (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        common_directory TEXT NOT NULL,
        id_prefix TEXT NOT NULL
      ) STRICT
    `.trim(),
    );
    yield* sql`
      INSERT INTO shared_state_identity (id, common_directory, id_prefix)
      SELECT id, common_directory, ${idPrefix}
      FROM shared_state_identity_before_internal_identities
    `;
    yield* sql.unsafe("DROP TABLE shared_state_identity_before_internal_identities");
    yield* sql.unsafe("DROP TABLE change_identity_map");
    yield* sql.unsafe("PRAGMA legacy_alter_table = OFF");

    const foreignKeyFailures = yield* sql`PRAGMA foreign_key_check`;
    if (foreignKeyFailures.length > 0) {
      return yield* Effect.fail(
        new Error("Internal identity migration did not preserve foreign keys"),
      );
    }
  });
