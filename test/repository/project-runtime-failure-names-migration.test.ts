import * as SqlClient from "@effect/sql/SqlClient";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { projectRuntimeFailureNamesMigration } from "../../src/sqlite/migrations/0028_project_runtime_failure_names.js";
import { nodeSqliteLayer } from "../../src/sqlite/nodeSqliteClient.js";

it.scoped("migrates provider-specific Tooling Failure names to project runtime names", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql.unsafe(`
      CREATE TABLE candidate_validation_tooling_failures (
        error_kind TEXT NOT NULL,
        operation_name TEXT NOT NULL
      )
    `);
    yield* sql.unsafe(`
      INSERT INTO candidate_validation_tooling_failures (error_kind, operation_name)
      VALUES ('sandcastle_tooling_failed', 'create_sandcastle_workspace')
    `);

    yield* projectRuntimeFailureNamesMigration;

    const rows = yield* sql<{
      readonly error_kind: string;
      readonly operation_name: string;
    }>`SELECT error_kind, operation_name FROM candidate_validation_tooling_failures`;
    expect(rows).toEqual([
      {
        error_kind: "reviewer_process_execution_failed",
        operation_name: "create_disposable_workspace",
      },
    ]);
  }).pipe(Effect.provide(nodeSqliteLayer(":memory:"))),
);
