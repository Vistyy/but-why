import { SqlClient } from "@effect/sql";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { onTestFinished } from "vitest";

export const acquireTestWorkspace = (): string => mkdtempSync(join(tmpdir(), "but-why-test-"));

export const releaseTestWorkspace = (workspace: string): void => {
  rmSync(workspace, { recursive: true, force: true });
};

export const testWorkspace = Effect.acquireRelease(Effect.sync(acquireTestWorkspace), (workspace) =>
  Effect.sync(() => releaseTestWorkspace(workspace)),
);

export const createTestWorkspace = (): string => {
  const workspace = acquireTestWorkspace();
  onTestFinished(() => releaseTestWorkspace(workspace));
  return workspace;
};

export const cloneInitializedTestRepository = (template: string) =>
  Effect.gen(function* () {
    const root = yield* Effect.sync(() => {
      const workspace = createTestWorkspace();
      cpSync(template, workspace, { recursive: true });
      return workspace;
    });
    const commonDirectory = join(root, ".git");
    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE shared_state_identity SET common_directory = ${commonDirectory}`;
    }).pipe(
      Effect.provide(
        SqliteClient.layer({ filename: join(commonDirectory, "but-why", "state.sqlite") }),
      ),
      Effect.scoped,
    );
    return root;
  }).pipe(Effect.orDie);
