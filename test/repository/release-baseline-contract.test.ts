import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { withTemporaryRepositoryState } from "../support/repository.js";

const expectedColumns = {
  shared_state_identity: ["id", "common_directory", "id_prefix"],
  tasks: [
    "id",
    "title",
    "description",
    "state",
    "cancel_reason",
    "reviewer_configuration",
    "reviewer_agent_session_id",
  ],
  task_dependencies: ["dependent_task_id", "prerequisite_task_id"],
  task_reviews: [
    "id",
    "task_id",
    "proposal",
    "dependency_evidence",
    "base_ref",
    "base_commit",
    "outcome",
    "findings",
    "tooling_failure",
    "cleanup_pending",
    "cleanup_blocking_reason",
  ],
  task_review_agent_invocations: ["task_review_id", "agent_invocation_id"],
  task_change_links: ["task_id", "change_id"],
  changes: [
    "id",
    "branch_ref",
    "base_ref",
    "base_remote_url",
    "worktree_path",
    "initial_acceptance_context",
    "reviewer_configuration",
    "prepare_definition",
    "prepare_failure",
    "close_reason",
    "cancel_reason",
    "cleanup_pending",
    "cleanup_blocking_reason",
  ],
  implementation_decisions: ["id", "change_id", "choice", "rationale"],
  implementation_blockers: ["id", "change_id", "content", "resolution_content"],
  candidates: ["id", "change_id", "base_commit", "head_commit"],
  validation_runs: [
    "id",
    "candidate_id",
    "policy_snapshot",
    "highest_decision_id",
    "highest_blocker_id",
    "outcome",
    "run_tooling_failure",
    "cleanup_pending",
    "cleanup_blocking_reason",
  ],
  validation_phase_results: [
    "validation_run_id",
    "phase",
    "producer",
    "outcome",
    "findings",
    "artifacts",
    "tooling_failure",
  ],
  validation_phase_agent_invocations: [
    "validation_run_id",
    "phase",
    "producer",
    "agent_invocation_id",
  ],
  change_agent_sessions: ["change_id", "producer", "agent_session_id"],
  github_publications: ["change_id", "candidate_id", "validation_run_id", "pull_request_number"],
  agent_sessions: ["id"],
  agent_continuations: [
    "id",
    "agent_session_id",
    "harness",
    "provider",
    "model",
    "thinking",
    "transcript_path",
    "unusable_reason",
  ],
  agent_invocations: [
    "id",
    "continuation_id",
    "created_at",
    "settled_at",
    "settlement_kind",
    "input_tokens",
    "cached_input_tokens",
    "cache_write_tokens",
    "output_tokens",
    "total_tokens",
  ],
} as const;

const expectedIndexes = [
  "agent_continuations_session_id_idx",
  "agent_invocations_continuation_id_idx",
  "agent_invocations_unsettled_idx",
  "candidates_change_id_idx",
  "changes_close_reason_id_idx",
  "implementation_blockers_change_id_idx",
  "implementation_blockers_unresolved_idx",
  "implementation_decisions_change_id_idx",
  "task_dependencies_prerequisite_idx",
  "task_reviews_active_idx",
  "task_reviews_task_id_idx",
  "tasks_state_id_idx",
  "validation_runs_active_idx",
  "validation_runs_candidate_id_idx",
  "validation_runs_passed_idx",
] as const;

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

      for (const [table, expected] of Object.entries(expectedColumns)) {
        const columns = yield* repository.operation(`inspect ${table} columns`, (sql) =>
          sql.unsafe<{ readonly name: string }>(`PRAGMA table_info(${table})`),
        );
        expect(
          columns.map((column) => column.name),
          table,
        ).toEqual(expected);
      }

      expect(
        objects
          .filter((object) => object.type === "index")
          .map((index) => index.name)
          .sort(),
      ).toEqual([...expectedIndexes].sort());
      expect(tables.every((table) => !table.sql?.includes("AUTOINCREMENT"))).toBe(true);
      expect(
        tables
          .filter((table) => table.name !== "agent_invocations")
          .every((table) => !table.sql?.match(/created_at|updated_at|closed_at|round_number/)),
      ).toBe(true);

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
