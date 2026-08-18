import { expect, it } from "@effect/vitest";
import { type Context, Effect } from "effect";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { withTemporaryRepositoryState } from "../support/repository.js";

const expectedColumns = {
  shared_state_identity: ["id:INTEGER:0:1", "common_directory:TEXT:1:0", "id_prefix:TEXT:1:0"],
  agent_sessions: ["id:INTEGER:0:1"],
  agent_continuations: [
    "id:INTEGER:0:1",
    "agent_session_id:INTEGER:1:0",
    "harness:TEXT:1:0",
    "provider:TEXT:0:0",
    "model:TEXT:1:0",
    "thinking:TEXT:0:0",
    "transcript_path:TEXT:0:0",
    "unusable_reason:TEXT:0:0",
  ],
  agent_invocations: [
    "id:INTEGER:0:1",
    "continuation_id:INTEGER:1:0",
    "created_at:TEXT:1:0",
    "settled_at:TEXT:0:0",
    "settlement_kind:TEXT:0:0",
    "input_tokens:INTEGER:0:0",
    "cached_input_tokens:INTEGER:0:0",
    "cache_write_tokens:INTEGER:0:0",
    "output_tokens:INTEGER:0:0",
    "total_tokens:INTEGER:0:0",
  ],
  tasks: [
    "id:INTEGER:0:1",
    "title:TEXT:1:0",
    "description:TEXT:1:0",
    "state:TEXT:1:0",
    "cancel_reason:TEXT:0:0",
    "reviewer_configuration:TEXT:0:0",
    "reviewer_agent_session_id:INTEGER:0:0",
  ],
  task_dependencies: ["dependent_task_id:INTEGER:1:1", "prerequisite_task_id:INTEGER:1:2"],
  task_reviews: [
    "id:INTEGER:0:1",
    "task_id:INTEGER:1:0",
    "proposal:TEXT:1:0",
    "dependency_evidence:TEXT:1:0",
    "base_ref:TEXT:1:0",
    "base_commit:TEXT:1:0",
    "outcome:TEXT:0:0",
    "findings:TEXT:1:0",
    "tooling_failure:TEXT:0:0",
    "cleanup_pending:INTEGER:1:0",
    "cleanup_blocking_reason:TEXT:0:0",
  ],
  task_review_agent_invocations: ["task_review_id:INTEGER:1:1", "agent_invocation_id:INTEGER:1:2"],
  changes: [
    "id:INTEGER:0:1",
    "branch_ref:TEXT:1:0",
    "base_ref:TEXT:1:0",
    "base_remote_url:TEXT:1:0",
    "worktree_path:TEXT:1:0",
    "initial_acceptance_context:TEXT:0:0",
    "reviewer_configuration:TEXT:1:0",
    "prepare_definition:TEXT:0:0",
    "checks_definition:TEXT:0:0",
    "prepare_failure:TEXT:0:0",
    "close_reason:TEXT:0:0",
    "cancel_reason:TEXT:0:0",
    "cleanup_pending:INTEGER:1:0",
    "cleanup_blocking_reason:TEXT:0:0",
  ],
  task_change_links: ["task_id:INTEGER:0:1", "change_id:INTEGER:1:0"],
  implementation_decisions: [
    "id:INTEGER:0:1",
    "change_id:INTEGER:1:0",
    "choice:TEXT:1:0",
    "rationale:TEXT:1:0",
  ],
  implementation_blockers: [
    "id:INTEGER:0:1",
    "change_id:INTEGER:1:0",
    "content:TEXT:1:0",
    "resolution_content:TEXT:0:0",
  ],
  candidates: [
    "id:INTEGER:0:1",
    "change_id:INTEGER:1:0",
    "base_commit:TEXT:1:0",
    "head_commit:TEXT:1:0",
  ],
  validation_runs: [
    "id:INTEGER:0:1",
    "candidate_id:INTEGER:1:0",
    "validation_input_snapshot:TEXT:1:0",
    "highest_decision_id:INTEGER:0:0",
    "highest_blocker_id:INTEGER:0:0",
    "outcome:TEXT:0:0",
    "run_tooling_failure:TEXT:0:0",
    "cleanup_pending:INTEGER:1:0",
    "cleanup_blocking_reason:TEXT:0:0",
  ],
  validation_phase_results: [
    "validation_run_id:INTEGER:1:1",
    "phase:TEXT:1:2",
    "producer:TEXT:1:3",
    "outcome:TEXT:1:0",
    "findings:TEXT:1:0",
    "artifacts:TEXT:1:0",
    "tooling_failure:TEXT:0:0",
  ],
  validation_phase_agent_invocations: [
    "validation_run_id:INTEGER:1:1",
    "phase:TEXT:1:2",
    "producer:TEXT:1:3",
    "agent_invocation_id:INTEGER:1:4",
  ],
  change_agent_sessions: [
    "change_id:INTEGER:1:1",
    "producer:TEXT:1:2",
    "agent_session_id:INTEGER:1:0",
  ],
  github_publications: [
    "change_id:INTEGER:0:1",
    "candidate_id:INTEGER:1:0",
    "validation_run_id:INTEGER:1:0",
    "pull_request_number:INTEGER:0:0",
  ],
} as const;

const expectedForeignKeys = {
  agent_continuations: ["agent_session_id->agent_sessions.id"],
  agent_invocations: ["continuation_id->agent_continuations.id"],
  tasks: ["reviewer_agent_session_id->agent_sessions.id"],
  task_dependencies: ["dependent_task_id->tasks.id", "prerequisite_task_id->tasks.id"],
  task_reviews: ["task_id->tasks.id"],
  task_review_agent_invocations: [
    "agent_invocation_id->agent_invocations.id",
    "task_review_id->task_reviews.id",
  ],
  task_change_links: ["change_id->changes.id", "task_id->tasks.id"],
  implementation_decisions: ["change_id->changes.id"],
  implementation_blockers: ["change_id->changes.id"],
  candidates: ["change_id->changes.id"],
  validation_runs: [
    "candidate_id->candidates.id",
    "highest_blocker_id->implementation_blockers.id",
    "highest_decision_id->implementation_decisions.id",
  ],
  validation_phase_results: ["validation_run_id->validation_runs.id"],
  validation_phase_agent_invocations: [
    "agent_invocation_id->agent_invocations.id",
    "validation_run_id->validation_runs.id",
  ],
  change_agent_sessions: ["agent_session_id->agent_sessions.id", "change_id->changes.id"],
  github_publications: [
    "candidate_id->candidates.id",
    "change_id->changes.id",
    "validation_run_id->validation_runs.id",
  ],
} as const;

const expectedIndexes = {
  agent_continuations_session_id_idx: {
    table: "agent_continuations",
    unique: 0,
    partial: 0,
    keys: ["agent_session_id:ASC", "id:DESC"],
  },
  agent_invocations_continuation_id_idx: {
    table: "agent_invocations",
    unique: 0,
    partial: 0,
    keys: ["continuation_id:ASC", "id:ASC"],
  },
  agent_invocations_unsettled_idx: {
    table: "agent_invocations",
    unique: 0,
    partial: 1,
    keys: ["continuation_id:ASC"],
    predicate: "WHERE settled_at IS NULL",
  },
  candidates_change_id_idx: {
    table: "candidates",
    unique: 0,
    partial: 0,
    keys: ["change_id:ASC", "id:DESC"],
  },
  changes_close_reason_id_idx: {
    table: "changes",
    unique: 0,
    partial: 0,
    keys: ["close_reason:ASC", "id:ASC"],
  },
  implementation_blockers_change_id_idx: {
    table: "implementation_blockers",
    unique: 0,
    partial: 0,
    keys: ["change_id:ASC", "id:ASC"],
  },
  implementation_blockers_unresolved_idx: {
    table: "implementation_blockers",
    unique: 1,
    partial: 1,
    keys: ["change_id:ASC"],
    predicate: "WHERE resolution_content IS NULL",
  },
  implementation_decisions_change_id_idx: {
    table: "implementation_decisions",
    unique: 0,
    partial: 0,
    keys: ["change_id:ASC", "id:ASC"],
  },
  task_dependencies_prerequisite_idx: {
    table: "task_dependencies",
    unique: 0,
    partial: 0,
    keys: ["prerequisite_task_id:ASC", "dependent_task_id:ASC"],
  },
  task_reviews_active_idx: {
    table: "task_reviews",
    unique: 1,
    partial: 1,
    keys: ["task_id:ASC"],
    predicate: "WHERE outcome IS NULL",
  },
  task_reviews_task_id_idx: {
    table: "task_reviews",
    unique: 0,
    partial: 0,
    keys: ["task_id:ASC", "id:DESC"],
  },
  tasks_state_id_idx: {
    table: "tasks",
    unique: 0,
    partial: 0,
    keys: ["state:ASC", "id:ASC"],
  },
  validation_runs_active_idx: {
    table: "validation_runs",
    unique: 0,
    partial: 1,
    keys: ["candidate_id:ASC", "id:DESC"],
    predicate: "WHERE outcome IS NULL",
  },
  validation_runs_candidate_id_idx: {
    table: "validation_runs",
    unique: 0,
    partial: 0,
    keys: ["candidate_id:ASC", "id:DESC"],
  },
  validation_runs_passed_idx: {
    table: "validation_runs",
    unique: 0,
    partial: 1,
    keys: ["candidate_id:ASC", "id:DESC"],
    predicate: "WHERE outcome = 'passed'",
  },
} as const;

const expectedImplicitUniqueIndexes = {
  change_agent_sessions: ["pk:change_id,producer", "u:agent_session_id"],
  changes: ["u:branch_ref", "u:worktree_path"],
  task_change_links: ["u:change_id"],
  task_dependencies: ["pk:dependent_task_id,prerequisite_task_id"],
  task_review_agent_invocations: ["pk:task_review_id,agent_invocation_id", "u:agent_invocation_id"],
  tasks: ["u:reviewer_agent_session_id"],
  validation_phase_agent_invocations: [
    "pk:validation_run_id,phase,producer,agent_invocation_id",
    "u:agent_invocation_id",
  ],
  validation_phase_results: ["pk:validation_run_id,phase,producer"],
} as const;

const expectStatementRejected = (
  repository: Context.Tag.Service<typeof RepositorySql>,
  operationName: string,
  statement: string,
) =>
  Effect.gen(function* () {
    const attempted = yield* Effect.either(
      repository.operation(operationName, (sql) => sql.unsafe(statement)),
    );
    expect(attempted._tag, `${operationName} must be rejected`).toBe("Left");
  });

it.scoped("installs the exact first-release product schema from one baseline migration", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      const objects = yield* repository.operation(
        "inspect baseline schema",
        (sql) =>
          sql<{ readonly type: string; readonly name: string; readonly sql: string | null }>`
          SELECT type, name, sql FROM sqlite_master
          WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE 'effect_sql_%'
          ORDER BY type, name
        `,
      );
      const tables = objects.filter((object) => object.type === "table");
      expect(tables.map((table) => table.name).sort()).toEqual(Object.keys(expectedColumns).sort());
      expect(tables).toHaveLength(18);

      const tableList = yield* repository.operation("inspect strict table flags", (sql) =>
        sql.unsafe<{ readonly name: string; readonly strict: number }>("PRAGMA table_list"),
      );
      expect(
        tableList
          .filter((table) => Object.hasOwn(expectedColumns, table.name))
          .map((table) => `${table.name}:${table.strict}`)
          .sort(),
      ).toEqual(
        Object.keys(expectedColumns)
          .map((table) => `${table}:1`)
          .sort(),
      );

      for (const [table, expected] of Object.entries(expectedColumns)) {
        const columns = yield* repository.operation(`inspect ${table} columns`, (sql) =>
          sql.unsafe<{
            readonly name: string;
            readonly type: string;
            readonly notnull: number;
            readonly dflt_value: unknown;
            readonly pk: number;
          }>(`PRAGMA table_info(${table})`),
        );
        expect(
          columns.every((column) => column.dflt_value === null),
          table,
        ).toBe(true);
        expect(
          columns.map((column) => `${column.name}:${column.type}:${column.notnull}:${column.pk}`),
          table,
        ).toEqual(expected);
      }

      for (const table of Object.keys(expectedColumns)) {
        const foreignKeys = yield* repository.operation(`inspect ${table} foreign keys`, (sql) =>
          sql.unsafe<{
            readonly table: string;
            readonly from: string;
            readonly to: string;
            readonly on_update: string;
            readonly on_delete: string;
            readonly match: string;
          }>(`PRAGMA foreign_key_list(${table})`),
        );
        expect(
          foreignKeys.map((key) => `${key.from}->${key.table}.${key.to}`).sort(),
          table,
        ).toEqual(
          [...(expectedForeignKeys[table as keyof typeof expectedForeignKeys] ?? [])].sort(),
        );
        expect(
          foreignKeys.every(
            (key) =>
              key.on_update === "NO ACTION" &&
              key.on_delete === "NO ACTION" &&
              key.match === "NONE",
          ),
          table,
        ).toBe(true);
      }

      const namedIndexes = objects.filter((object) => object.type === "index");
      expect(namedIndexes.map((index) => index.name).sort()).toEqual(
        Object.keys(expectedIndexes).sort(),
      );
      for (const [name, expected] of Object.entries(expectedIndexes)) {
        const listed = yield* repository.operation(`inspect ${name} flags`, (sql) =>
          sql.unsafe<{ readonly name: string; readonly unique: number; readonly partial: number }>(
            `PRAGMA index_list(${expected.table})`,
          ),
        );
        expect(
          listed.find((index) => index.name === name),
          name,
        ).toMatchObject({
          unique: expected.unique,
          partial: expected.partial,
        });
        const keys = yield* repository.operation(`inspect ${name} keys`, (sql) =>
          sql.unsafe<{
            readonly name: string | null;
            readonly desc: number;
            readonly key: number;
          }>(`PRAGMA index_xinfo(${name})`),
        );
        expect(
          keys
            .filter((key) => key.key === 1)
            .map((key) => `${key.name}:${key.desc === 1 ? "DESC" : "ASC"}`),
          name,
        ).toEqual(expected.keys);
        const source = namedIndexes.find((index) => index.name === name)?.sql ?? "";
        if ("predicate" in expected) {
          expect(source.replace(/\s+/gu, " ")).toContain(expected.predicate);
        } else {
          expect(source.toUpperCase()).not.toContain(" WHERE ");
        }
      }

      for (const table of Object.keys(expectedColumns)) {
        const listed = yield* repository.operation(`inspect ${table} implicit indexes`, (sql) =>
          sql.unsafe<{
            readonly name: string;
            readonly unique: number;
            readonly origin: string;
            readonly partial: number;
          }>(`PRAGMA index_list(${table})`),
        );
        const implicit: string[] = [];
        for (const index of listed.filter((index) => index.origin !== "c")) {
          expect(index.unique, index.name).toBe(1);
          expect(index.partial, index.name).toBe(0);
          const keys = yield* repository.operation(`inspect ${index.name} implicit keys`, (sql) =>
            sql.unsafe<{ readonly name: string }>(`PRAGMA index_info(${index.name})`),
          );
          implicit.push(`${index.origin}:${keys.map((key) => key.name).join(",")}`);
        }
        expect(implicit.sort(), table).toEqual(
          [
            ...(expectedImplicitUniqueIndexes[
              table as keyof typeof expectedImplicitUniqueIndexes
            ] ?? []),
          ].sort(),
        );
      }

      expect(tables.every((table) => !table.sql?.includes("AUTOINCREMENT"))).toBe(true);
      expect(
        tables
          .filter((table) => table.name !== "agent_invocations")
          .every((table) => !table.sql?.match(/created_at|updated_at|closed_at|round_number/)),
      ).toBe(true);

      const foreignKeysEnabled = yield* repository.operation(
        "inspect foreign key enforcement",
        (sql) => sql.unsafe<{ readonly foreign_keys: number }>("PRAGMA foreign_keys"),
      );
      expect(foreignKeysEnabled).toEqual([{ foreign_keys: 1 }]);

      yield* repository.operation("create baseline constraint parents", (sql) =>
        Effect.gen(function* () {
          yield* sql.unsafe("INSERT INTO agent_sessions (id) VALUES (1)");
          yield* sql.unsafe(
            "INSERT INTO agent_continuations (id, agent_session_id, harness, model) VALUES (1, 1, 'pi', 'test')",
          );
          yield* sql.unsafe(
            "INSERT INTO tasks (id, title, description, state) VALUES (1, 'Task', 'Intent', 'new')",
          );
          yield* sql.unsafe(
            "INSERT INTO changes (id, branch_ref, base_ref, base_remote_url, worktree_path, reviewer_configuration, checks_definition, cleanup_pending) VALUES (1, 'refs/heads/change', 'refs/heads/main', 'https://example.test/repo.git', '/tmp/change', '{}', '[]', 0)",
          );
          yield* sql.unsafe(
            "INSERT INTO candidates (id, change_id, base_commit, head_commit) VALUES (1, 1, 'base', 'head')",
          );
          yield* sql.unsafe(
            "INSERT INTO validation_runs (id, candidate_id, validation_input_snapshot, cleanup_pending) VALUES (1, 1, '{}', 0)",
          );
        }),
      );

      yield* expectStatementRejected(
        repository,
        "reject non-singleton Shared State identity",
        "UPDATE shared_state_identity SET id = 2 WHERE id = 1",
      );
      const identityInsertions = [
        {
          name: "Agent Session",
          statement: (id: number) => `INSERT INTO agent_sessions (id) VALUES (${id})`,
        },
        {
          name: "Agent Continuation",
          statement: (id: number) =>
            `INSERT INTO agent_continuations (id, agent_session_id, harness, model) VALUES (${id}, 1, 'pi', 'test')`,
        },
        {
          name: "Agent Invocation",
          statement: (id: number) =>
            `INSERT INTO agent_invocations (id, continuation_id, created_at) VALUES (${id}, 1, 'now')`,
        },
        {
          name: "Task",
          statement: (id: number) =>
            `INSERT INTO tasks (id, title, description, state) VALUES (${id}, 'Task', 'Intent', 'new')`,
        },
        {
          name: "Task Review",
          statement: (id: number) =>
            `INSERT INTO task_reviews (id, task_id, proposal, dependency_evidence, base_ref, base_commit, findings, cleanup_pending) VALUES (${id}, 1, '{}', '[]', 'main', 'head', '[]', 0)`,
        },
        {
          name: "Change",
          statement: (id: number) =>
            `INSERT INTO changes (id, branch_ref, base_ref, base_remote_url, worktree_path, reviewer_configuration, checks_definition, cleanup_pending) VALUES (${id}, 'refs/heads/change-${id}', 'main', 'url', '/tmp/change-${id}', '{}', '[]', 0)`,
        },
        {
          name: "Implementation Decision",
          statement: (id: number) =>
            `INSERT INTO implementation_decisions (id, change_id, choice, rationale) VALUES (${id}, 1, 'choice', 'rationale')`,
        },
        {
          name: "Implementation Blocker",
          statement: (id: number) =>
            `INSERT INTO implementation_blockers (id, change_id, content) VALUES (${id}, 1, 'content')`,
        },
        {
          name: "Candidate",
          statement: (id: number) =>
            `INSERT INTO candidates (id, change_id, base_commit, head_commit) VALUES (${id}, 1, 'other-base', 'other-head')`,
        },
        {
          name: "Validation Run",
          statement: (id: number) =>
            `INSERT INTO validation_runs (id, candidate_id, validation_input_snapshot, cleanup_pending) VALUES (${id}, 1, '{}', 0)`,
        },
      ];
      for (const identity of identityInsertions) {
        for (const invalidId of [0, 9_007_199_254_740_992]) {
          yield* expectStatementRejected(
            repository,
            `reject ${identity.name} identity ${invalidId}`,
            identity.statement(invalidId),
          );
        }
      }
      yield* expectStatementRejected(
        repository,
        "reject missing foreign key parent",
        "INSERT INTO task_dependencies VALUES (1, 999)",
      );
      yield* expectStatementRejected(
        repository,
        "reject invalid Task lifecycle state",
        "INSERT INTO tasks (id, title, description, state) VALUES (2, 'Task', 'Intent', 'unknown')",
      );
      yield* expectStatementRejected(
        repository,
        "reject inconsistent Task cancellation",
        "INSERT INTO tasks (id, title, description, state, cancel_reason) VALUES (2, 'Task', 'Intent', 'new', 'reason')",
      );
      yield* expectStatementRejected(
        repository,
        "reject cancelled Task without cancellation reason",
        "INSERT INTO tasks (id, title, description, state) VALUES (2, 'Task', 'Intent', 'cancelled')",
      );
      yield* expectStatementRejected(
        repository,
        "reject incomplete Task reviewer configuration",
        "INSERT INTO tasks (id, title, description, state, reviewer_configuration) VALUES (2, 'Task', 'Intent', 'new', '{}')",
      );
      yield* expectStatementRejected(
        repository,
        "reject Task reviewer Agent Session without configuration",
        "INSERT INTO tasks (id, title, description, state, reviewer_agent_session_id) VALUES (2, 'Task', 'Intent', 'new', 1)",
      );
      yield* expectStatementRejected(
        repository,
        "reject invalid Task Review outcome",
        "INSERT INTO task_reviews (id, task_id, proposal, dependency_evidence, base_ref, base_commit, outcome, findings, cleanup_pending) VALUES (1, 1, '{}', '[]', 'main', 'head', 'unknown', '[]', 0)",
      );
      for (const invalidCleanup of [-1, 2]) {
        yield* expectStatementRejected(
          repository,
          `reject Task Review cleanup flag ${invalidCleanup}`,
          `INSERT INTO task_reviews (id, task_id, proposal, dependency_evidence, base_ref, base_commit, findings, cleanup_pending) VALUES (1, 1, '{}', '[]', 'main', 'head', '[]', ${invalidCleanup})`,
        );
      }
      yield* expectStatementRejected(
        repository,
        "reject inconsistent Change closure",
        "INSERT INTO changes (id, branch_ref, base_ref, base_remote_url, worktree_path, reviewer_configuration, checks_definition, close_reason, cancel_reason, cleanup_pending) VALUES (2, 'refs/heads/change-2', 'main', 'url', '/tmp/change-2', '{}', '[]', 'completed', 'reason', 0)",
      );
      yield* expectStatementRejected(
        repository,
        "reject cancelled Change without cancellation reason",
        "INSERT INTO changes (id, branch_ref, base_ref, base_remote_url, worktree_path, reviewer_configuration, checks_definition, close_reason, cleanup_pending) VALUES (2, 'refs/heads/change-2', 'main', 'url', '/tmp/change-2', '{}', '[]', 'cancelled', 0)",
      );
      yield* expectStatementRejected(
        repository,
        "reject open Change with cancellation reason",
        "INSERT INTO changes (id, branch_ref, base_ref, base_remote_url, worktree_path, reviewer_configuration, checks_definition, cancel_reason, cleanup_pending) VALUES (2, 'refs/heads/change-2', 'main', 'url', '/tmp/change-2', '{}', '[]', 'reason', 0)",
      );
      for (const invalidCleanup of [-1, 2]) {
        yield* expectStatementRejected(
          repository,
          `reject Change cleanup flag ${invalidCleanup}`,
          `INSERT INTO changes (id, branch_ref, base_ref, base_remote_url, worktree_path, reviewer_configuration, checks_definition, cleanup_pending) VALUES (2, 'refs/heads/change-2', 'main', 'url', '/tmp/change-2', '{}', '[]', ${invalidCleanup})`,
        );
      }
      yield* expectStatementRejected(
        repository,
        "reject unsettled invocation settlement kind",
        "INSERT INTO agent_invocations (id, continuation_id, created_at, settlement_kind) VALUES (1, 1, 'now', 'returned')",
      );
      yield* expectStatementRejected(
        repository,
        "reject settled invocation without settlement kind",
        "INSERT INTO agent_invocations (id, continuation_id, created_at, settled_at) VALUES (1, 1, 'now', 'later')",
      );
      yield* expectStatementRejected(
        repository,
        "reject partial Agent token usage",
        "INSERT INTO agent_invocations (id, continuation_id, created_at, input_tokens) VALUES (1, 1, 'now', 1)",
      );
      const tokenColumns = [
        "input_tokens",
        "cached_input_tokens",
        "cache_write_tokens",
        "output_tokens",
        "total_tokens",
      ] as const;
      for (const omittedToken of tokenColumns) {
        const values = tokenColumns.map((tokenColumn) =>
          tokenColumn === omittedToken ? "NULL" : "0",
        );
        yield* expectStatementRejected(
          repository,
          `reject Agent token usage missing ${omittedToken}`,
          `INSERT INTO agent_invocations (id, continuation_id, created_at, settled_at, settlement_kind, input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, total_tokens) VALUES (1, 1, 'now', 'later', 'returned', ${values.join(", ")})`,
        );
      }
      for (const tokenColumn of tokenColumns) {
        for (const invalidToken of [-1, 9_007_199_254_740_992]) {
          const values = {
            input_tokens: 0,
            cached_input_tokens: 0,
            cache_write_tokens: 0,
            output_tokens: 0,
            total_tokens: 0,
          };
          values[tokenColumn] = invalidToken;
          yield* expectStatementRejected(
            repository,
            `reject ${tokenColumn} value ${invalidToken}`,
            `INSERT INTO agent_invocations (id, continuation_id, created_at, settled_at, settlement_kind, input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, total_tokens) VALUES (1, 1, 'now', 'later', 'returned', ${values.input_tokens}, ${values.cached_input_tokens}, ${values.cache_write_tokens}, ${values.output_tokens}, ${values.total_tokens})`,
          );
        }
      }
      yield* expectStatementRejected(
        repository,
        "reject invalid Validation Run outcome",
        "INSERT INTO validation_runs (id, candidate_id, validation_input_snapshot, outcome, cleanup_pending) VALUES (2, 1, '{}', 'unknown', 0)",
      );
      for (const invalidCleanup of [-1, 2]) {
        yield* expectStatementRejected(
          repository,
          `reject Validation Run cleanup flag ${invalidCleanup}`,
          `INSERT INTO validation_runs (id, candidate_id, validation_input_snapshot, cleanup_pending) VALUES (2, 1, '{}', ${invalidCleanup})`,
        );
      }
      yield* expectStatementRejected(
        repository,
        "reject invalid Validation Phase outcome",
        "INSERT INTO validation_phase_results (validation_run_id, phase, producer, outcome, findings, artifacts) VALUES (1, 'check', 'test', 'unknown', '[]', '[]')",
      );
      yield* expectStatementRejected(
        repository,
        "reject nonpositive pull request number",
        "INSERT INTO github_publications (change_id, candidate_id, validation_run_id, pull_request_number) VALUES (1, 1, 1, 0)",
      );
      yield* expectStatementRejected(
        repository,
        "reject unsafe pull request number",
        "INSERT INTO github_publications (change_id, candidate_id, validation_run_id, pull_request_number) VALUES (1, 1, 1, 9007199254740992)",
      );

      const migrations = yield* repository.operation(
        "inspect migration ledger",
        (sql) =>
          sql<{ readonly migrationId: number }>`
          SELECT migration_id AS migrationId FROM effect_sql_migrations ORDER BY migration_id
        `,
      );
      expect(migrations).toEqual([{ migrationId: 1 }]);
    }),
  ),
);
