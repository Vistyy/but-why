import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { withTemporaryRepositoryState } from "../support/repository.js";

it.scoped("enforces stable Shared Repository State facts in SQLite", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      const schemas = yield* repository.operation(
        "inspect stable table schemas",
        (sql) =>
          sql<{ readonly name: string; readonly sql: string }>`
          SELECT name, sql FROM sqlite_schema
          WHERE type = 'table' AND name IN (
            'tasks', 'changes', 'candidates', 'candidate_validation_runs',
            'task_dependencies', 'candidate_validation_workspace_setups',
            'candidate_validation_tooling_failures', 'candidate_validation_rounds',
            'candidate_validation_findings', 'candidate_validation_artifacts',
            'active_validation_runs', 'implementation_decisions',
            'implementation_blockers', 'reviewer_sessions', 'reviewer_transcripts',
            'shared_state_identity'
          )
        `,
      );
      expect(schemas).toHaveLength(16);
      expect(schemas.every(({ sql }) => sql.endsWith("STRICT"))).toBe(true);

      yield* expectSqlRejection(
        repository.operation("reject a wrong Task storage class", (sql) =>
          sql.unsafe(`
            INSERT INTO tasks (
              id, numeric_id, title, description, state, cancel_reason, created_at, updated_at
            ) VALUES ('BY-1', 1, X'00', 'Description', 'new', NULL, 'now', 'now')
          `),
        ),
      );
      yield* expectSqlRejection(
        repository.operation("reject an incomplete preparation relationship", (sql) =>
          sql.unsafe(`
            INSERT INTO changes (
              id, repository_common_directory, branch_ref, state,
              created_at, updated_at, prepare_command
            ) VALUES ('change-1', '/repo/.git', 'refs/heads/change-1', 'open', 'now', 'now', 'prepare')
          `),
        ),
      );
      yield* expectSqlRejection(
        repository.operation("reject an unsupported Tooling Failure kind", (sql) =>
          sql.unsafe(`
            INSERT INTO candidate_validation_tooling_failures (
              validation_run_id, error_kind, operation_name, error_message, created_at
            ) VALUES ('missing-run', 'retired_kind', 'operation', 'message', 'now')
          `),
        ),
      );
      yield* expectSqlRejection(
        repository.operation("reject a dangling Task dependency", (sql) =>
          sql.unsafe(`
            INSERT INTO task_dependencies (dependent_task_id, prerequisite_task_id)
            VALUES ('missing-dependent', 'missing-prerequisite')
          `),
        ),
      );
    }),
  ),
);

const expectSqlRejection = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(effect);
    expect(error).toMatchObject({ _tag: "RepositorySqlOperationFailed" });
  });
