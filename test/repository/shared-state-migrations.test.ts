import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as SqlClient from "@effect/sql/SqlClient";
import { expect, it } from "@effect/vitest";
import { Cause, Effect } from "effect";
import { describe } from "vitest";

import {
  RepositoryMigrationFailed,
  RepositoryRestoredTransientState,
  RepositorySqlOperationFailed,
} from "../../src/contracts/repositoryStorageError.js";
import { removePreNativeSnapshotWorkspaceCleanupMigration } from "../../src/sqlite/migrations/0033_remove_pre_native_snapshot_workspace_cleanup.js";
import { nodeSqliteLayer } from "../../src/sqlite/nodeSqliteClient.js";
import { RepositorySql, repositorySqlLayer } from "../../src/sqlite/repositorySql.js";
import { encodeSqliteCandidateValidationPolicy } from "../../src/sqlite/sqliteCandidateValidationPolicy.js";
import { withTemporaryRepositoryState as withTemporaryState } from "../support/repository.js";
import {
  migrateTestRepositoryThrough,
  testRepositoryMigrationLedger,
} from "../support/repositoryMigrations.js";

const createPreNativeCleanupTable = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(`
    CREATE TABLE pre_native_snapshot_workspace_cleanups (
      validation_run_id TEXT PRIMARY KEY,
      retired_ref_name TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      expected_commit_sha TEXT NOT NULL
    ) STRICT
  `);
});

describe("Shared Repository State migrations", () => {
  it.effect(
    "drops Candidate Publication chronology while preserving current publication facts",
    () =>
      Effect.acquireUseRelease(
        Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
        (directory) =>
          Effect.gen(function* () {
            const statePath = join(directory, "state.sqlite");
            yield* Effect.scoped(
              Effect.gen(function* () {
                const sql = yield* SqlClient.SqlClient;
                yield* migrateTestRepositoryThrough(19);
                yield* sql`
                INSERT INTO changes (
                  id, repository_common_directory, branch_ref, state, created_at, updated_at,
                  publication_candidate_id, publication_validation_run_id, publication_owner,
                  publication_repo, publication_base_branch, publication_remote_name,
                  publication_head_branch, publication_expected_head_sha,
                  publication_pr_number, publication_pr_url
                ) VALUES (
                  'change-publication', ${directory}, 'refs/heads/legacy', 'open',
                  '2026-07-25T15:30:00.000Z', '2026-07-25T15:30:00.000Z',
                  'candidate-publication', 'run-publication', 'acme', 'repo', 'main', 'origin',
                  'legacy', 'head-legacy', 7, 'https://github.test/pull/7'
                )
              `;
                yield* sql`
                INSERT INTO candidates (id, change_id, change_base_sha, head_sha, created_at)
                VALUES (
                  'candidate-publication', 'change-publication', 'base-legacy', 'head-legacy',
                  '2026-07-25T15:30:00.000Z'
                )
              `;
                yield* sql`
                INSERT INTO candidate_validation_runs (
                  id, candidate_id, policy_snapshot, implementation_decisions,
                  latest_resolved_blocker_id, state, outcome, created_at, updated_at
                ) VALUES (
                  'run-publication', 'candidate-publication',
                  '{"checks":[],"copyFiles":[],"specialistReviews":[]}', '[]', NULL,
                  'complete', 'passed', '2026-07-25T15:30:00.000Z',
                  '2026-07-25T15:30:00.000Z'
                )
              `;
                yield* sql`
                INSERT INTO candidate_publications (
                  change_id, candidate_id, validation_run_id, change_base_sha, head_sha,
                  publication_owner, publication_repo, publication_base_branch,
                  publication_remote_name, publication_head_branch, pull_request_number,
                  pull_request_url, published_at
                ) VALUES (
                  'change-publication', 'candidate-publication', 'run-publication',
                  'base-legacy', 'head-legacy', 'acme', 'repo', 'main', 'origin', 'legacy', 7,
                  'https://github.test/pull/7', '2026-07-25T15:30:00.000Z'
                )
              `;
              }).pipe(Effect.provide(nodeSqliteLayer(statePath))),
            );

            yield* Effect.scoped(
              Effect.gen(function* () {
                const repository = yield* RepositorySql;
                const publications = yield* repository.operation(
                  "read migrated Candidate Publication facts",
                  (sql) => sql<{
                    readonly candidateId: string;
                    readonly validationRunId: string;
                    readonly expectedHeadSha: string;
                    readonly pullRequestNumber: number;
                    readonly pullRequestUrl: string;
                  }>`
                    SELECT publication_candidate_id AS candidateId,
                      publication_validation_run_id AS validationRunId,
                      publication_expected_head_sha AS expectedHeadSha,
                      publication_pr_number AS pullRequestNumber,
                      publication_pr_url AS pullRequestUrl
                    FROM changes WHERE id = 'change-publication'
                  `,
                );
                expect(publications).toEqual([
                  {
                    candidateId: "candidate-publication",
                    validationRunId: "run-publication",
                    expectedHeadSha: "head-legacy",
                    pullRequestNumber: 7,
                    pullRequestUrl: "https://github.test/pull/7",
                  },
                ]);
                const tables = yield* repository.operation(
                  "read retired Candidate Publication tables",
                  (sql) => sql<{ readonly name: string }>`
                  SELECT name FROM sqlite_schema
                  WHERE type = 'table' AND name = 'candidate_publications'
                `,
                );
                expect(tables).toEqual([]);
              }).pipe(
                Effect.provide(
                  repositorySqlLayer({
                    commonDirectory: directory,
                    statePath,
                    lifecycle: "initialize",
                  }),
                ),
              ),
            );
          }),
        (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
      ),
  );

  it.scoped("applies the complete immutable ordered migration chain", () =>
    withTemporaryState(() =>
      Effect.gen(function* () {
        const repository = yield* RepositorySql;
        const migrations = yield* repository.operation(
          "read repository migration chain",
          (sql) => sql<{ readonly migration_id: number; readonly name: string }>`
            SELECT migration_id, name
            FROM effect_sql_migrations
            ORDER BY migration_id
          `,
        );

        expect(migrations).toEqual(
          testRepositoryMigrationLedger.map(([key]) => ({
            migration_id: Number(key.slice(0, 4)),
            name: key.slice(5),
          })),
        );
      }),
    ),
  );

  it.effect("backfills the newest-created Candidate as the current selection", () => {
    return Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.scoped(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* migrateTestRepositoryThrough(37);
            yield* sql`
              INSERT INTO changes (
                id, repository_common_directory, branch_ref, state, created_at, updated_at
              ) VALUES (
                'change-selection', ${directory}, 'refs/heads/selection', 'open',
                '2026-08-12T10:00:00.000Z', '2026-08-12T10:00:00.000Z'
              )
            `;
            yield* sql`
              INSERT INTO candidates (id, change_id, change_base_sha, head_sha, created_at)
              VALUES
                ('candidate-a', 'change-selection', 'base', 'head-a', '2026-08-12T10:01:00.000Z'),
                ('candidate-b', 'change-selection', 'base', 'head-b', '2026-08-12T10:02:00.000Z')
            `;
            yield* migrateTestRepositoryThrough(38);
            const selected = yield* sql<{
              readonly changeId: string;
              readonly candidateId: string;
            }>`
              SELECT change_id AS changeId, candidate_id AS candidateId
              FROM current_candidates
            `;
            const candidates = yield* sql<{ readonly id: string }>`
              SELECT id FROM candidates WHERE change_id = 'change-selection'
              ORDER BY id
            `;
            expect(selected).toEqual([
              { changeId: "change-selection", candidateId: "candidate-b" },
            ]);
            expect(candidates).toEqual([{ id: "candidate-a" }, { id: "candidate-b" }]);
          }).pipe(Effect.provide(nodeSqliteLayer(join(directory, "state.sqlite")))),
        ),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    );
  });

  it.effect("restores unsupported unlinked Todo Tasks to New", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.scoped(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* migrateTestRepositoryThrough(36);
            yield* sql`INSERT INTO tasks (
              id, numeric_id, title, description, state, cancel_reason, created_at, updated_at
            ) VALUES
              ('BY-1', 1, 'Unsupported Todo', 'No passing Review.', 'todo', NULL, '2026-08-12T10:00:00.000Z', '2026-08-12T10:00:00.000Z'),
              ('BY-2', 2, 'Passed Todo', 'Has passing Review.', 'todo', NULL, '2026-08-12T10:00:00.000Z', '2026-08-12T10:00:00.000Z'),
              ('BY-3', 3, 'Blocked Todo', 'Has only blocked Review.', 'todo', NULL, '2026-08-12T10:00:00.000Z', '2026-08-12T10:00:00.000Z'),
              ('BY-4', 4, 'Linked Todo', 'Change captured its Context.', 'todo', NULL, '2026-08-12T10:00:00.000Z', '2026-08-12T10:00:00.000Z'),
              ('BY-5', 5, 'New Task', 'Remain New.', 'new', NULL, '2026-08-12T10:00:00.000Z', '2026-08-12T10:00:00.000Z'),
              ('BY-6', 6, 'Done Task', 'Remain Done.', 'done', NULL, '2026-08-12T10:00:00.000Z', '2026-08-12T10:00:00.000Z'),
              ('BY-7', 7, 'Cancelled Task', 'Remain Cancelled.', 'cancelled', 'No longer needed.', '2026-08-12T10:00:00.000Z', '2026-08-12T10:00:00.000Z')`;
            yield* sql`INSERT INTO task_reviews (
              id, task_id, proposal_snapshot, dependency_evidence, policy_snapshot,
              base_ref, base_commit, workspace_path, state, outcome, workspace_cleanup,
              created_at, updated_at
            ) VALUES
              ('review-passed', 'BY-2',
               '{"title":"Passed Todo","description":"Has passing Review.","dependencyIds":[]}',
               '[]',
               '{"profile":{"agentProfile":"review","scope":"global","profile":{"agentRuntime":"pi"}},"builtInInstructions":"Review the Task.","guidance":null}',
               'refs/heads/main', 'base', ${join(directory, "passed")},
               'complete', 'passed', 'removed',
               '2026-08-12T10:00:00.000Z', '2026-08-12T10:00:00.000Z'),
              ('review-blocked', 'BY-3',
               '{"title":"Blocked Todo","description":"Has only blocked Review.","dependencyIds":[]}',
               '[]',
               '{"profile":{"agentProfile":"review","scope":"global","profile":{"agentRuntime":"pi"}},"builtInInstructions":"Review the Task.","guidance":null}',
               'refs/heads/main', 'base', ${join(directory, "blocked")},
               'complete', 'blocked', 'removed',
               '2026-08-12T10:00:00.000Z', '2026-08-12T10:00:00.000Z')`;
            yield* sql`INSERT INTO changes (
              id, repository_common_directory, branch_ref, task_id, state, created_at, updated_at,
              base_ref, base_remote_url, starting_commit, worktree_path, acceptance_context
            ) VALUES (
              'change-linked', ${directory}, 'refs/heads/linked', 'BY-4', 'open',
              '2026-08-12T10:00:00.000Z', '2026-08-12T10:00:00.000Z',
              'refs/remotes/origin/main', 'https://github.test/acme/repo.git', 'base',
              ${join(directory, "linked")},
              '{"version":1,"title":"Linked Todo","description":"Change captured its Context."}'
            )`;

            yield* migrateTestRepositoryThrough(37);

            const tasks = yield* sql<{ readonly id: string; readonly state: string }>`
              SELECT id, state FROM tasks ORDER BY numeric_id
            `;
            expect(tasks).toEqual([
              { id: "BY-1", state: "new" },
              { id: "BY-2", state: "todo" },
              { id: "BY-3", state: "new" },
              { id: "BY-4", state: "todo" },
              { id: "BY-5", state: "new" },
              { id: "BY-6", state: "done" },
              { id: "BY-7", state: "cancelled" },
            ]);
          }).pipe(Effect.provide(nodeSqliteLayer(join(directory, "state.sqlite")))),
        ),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.effect("upgrades supported lifecycle state records through the strict active schema", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          yield* Effect.scoped(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              yield* migrateTestRepositoryThrough(23);
              yield* sql`INSERT INTO tasks (id, numeric_id, title, description, state, cancel_reason, created_at, updated_at) VALUES
                ('BY-1', 1, 'New Task', 'Supported new.', 'new', NULL, '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z'),
                ('BY-2', 2, 'Todo Task', 'Supported todo.', 'todo', NULL, '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z'),
                ('BY-3', 3, 'Done Task', 'Supported done.', 'done', NULL, '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z'),
                ('BY-4', 4, 'Cancelled Task', 'Supported cancelled.', 'cancelled', 'Not needed', '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z')`;
              yield* sql`INSERT INTO task_comments (id, task_id, created_at, content) VALUES ('comment-1', 'BY-2', '2026-07-25T16:31:00.000Z', 'Keep this comment.')`;
              yield* sql`INSERT INTO task_dependencies (dependent_task_id, prerequisite_task_id) VALUES ('BY-2', 'BY-3')`;
              yield* sql`INSERT INTO changes (
                id, repository_common_directory, branch_ref, task_id, state, close_reason,
                cancel_reason, created_at, updated_at, closed_at, cleanup_state,
                base_ref, base_remote_url, starting_commit, worktree_path, acceptance_context
              ) VALUES
                ('change-open', ${directory}, 'refs/heads/open', 'BY-2', 'open', NULL, NULL,
                 '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z', NULL, 'complete',
                 'refs/remotes/origin/main', 'https://github.com/acme/repo.git', 'base-open',
                 ${join(directory, "open")},
                 '{"version":1,"title":"Todo Task","description":"Supported todo."}'),
                ('change-closed', ${directory}, 'refs/heads/closed', 'BY-3', 'closed', 'completed', NULL,
                 '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z',
                 '2026-07-25T16:30:00.000Z', 'complete', 'refs/remotes/origin/main',
                 'https://github.com/acme/repo.git', 'base-closed', ${join(directory, "closed")},
                 '{"version":1,"title":"Done Task","description":"Supported done."}')`;
            }).pipe(Effect.provide(nodeSqliteLayer(statePath))),
          );

          yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              const tasks = yield* repository.operation(
                "read migrated lifecycle Tasks",
                (sql) => sql<{
                  readonly id: string;
                  readonly state: string;
                  readonly cancel_reason: string | null;
                }>`
                  SELECT id, state, cancel_reason FROM tasks ORDER BY numeric_id
                `,
              );
              const changes = yield* repository.operation(
                "read migrated lifecycle Changes",
                (sql) => sql<{
                  readonly id: string;
                  readonly task_id: string | null;
                  readonly state: string;
                }>`
                  SELECT id, task_id, state FROM changes ORDER BY id
                `,
              );
              const commentsTable = yield* repository.operation(
                "verify discarded Task comment storage",
                (sql) => sql<{ readonly name: string }>`
                  SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task_comments'
                `,
              );
              const dependencies = yield* repository.operation(
                "read migrated Task dependencies",
                (sql) => sql<{
                  readonly dependent_task_id: string;
                  readonly prerequisite_task_id: string;
                }>`
                  SELECT dependent_task_id, prerequisite_task_id FROM task_dependencies
                `,
              );
              const migrations = yield* repository.operation(
                "read lifecycle migration chain",
                (sql) => sql<{ readonly name: string }>`
                  SELECT name FROM effect_sql_migrations WHERE migration_id = 24
                `,
              );
              expect(tasks).toEqual([
                { id: "BY-1", state: "new", cancel_reason: null },
                { id: "BY-2", state: "todo", cancel_reason: null },
                { id: "BY-3", state: "done", cancel_reason: null },
                { id: "BY-4", state: "cancelled", cancel_reason: "Not needed" },
              ]);
              expect(changes).toEqual([
                { id: "change-closed", task_id: "BY-3", state: "closed" },
                { id: "change-open", task_id: "BY-2", state: "open" },
              ]);
              expect(commentsTable).toEqual([]);
              expect(dependencies).toEqual([
                { dependent_task_id: "BY-2", prerequisite_task_id: "BY-3" },
              ]);
              expect(migrations).toEqual([{ name: "remove_task_comments" }]);

              const transientInsert = yield* repository
                .operation(
                  "attempt retired Task state insert",
                  (sql) => sql`
                    INSERT INTO tasks (id, numeric_id, title, description, state, created_at, updated_at)
                    VALUES ('BY-5', 5, 'Retired', 'Must be rejected.', 'implementing', '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z')
                  `,
                )
                .pipe(Effect.flip);
              expect(transientInsert).toBeInstanceOf(RepositorySqlOperationFailed);
            }).pipe(
              Effect.provide(
                repositorySqlLayer({
                  commonDirectory: directory,
                  statePath,
                  lifecycle: "initialize",
                }),
              ),
            ),
          );
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.effect(
    "stops a restored database containing each retired Task state with and without a linked Change",
    () =>
      Effect.acquireUseRelease(
        Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
        (directory) =>
          Effect.gen(function* () {
            for (const state of ["implementing", "blocked", "validating", "ready"] as const) {
              for (const linked of [false, true] as const) {
                const label = `${state}-${linked ? "linked" : "unlinked"}`;
                const stateDirectory = join(directory, label);
                mkdirSync(stateDirectory, { recursive: true });
                const statePath = join(stateDirectory, "state.sqlite");
                yield* Effect.scoped(
                  Effect.gen(function* () {
                    const sql = yield* SqlClient.SqlClient;
                    yield* migrateTestRepositoryThrough(22);
                    yield* sql`INSERT INTO tasks (id, numeric_id, title, description, state, created_at, updated_at) VALUES ('BY-1', 1, 'Restored Task', 'Retired state.', ${state}, '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z')`;
                    if (linked) {
                      yield* sql`INSERT INTO changes (id, repository_common_directory, branch_ref, task_id, state, created_at, updated_at, cleanup_state) VALUES ('change-linked', ${stateDirectory}, 'refs/heads/linked', 'BY-1', 'open', '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z', 'complete')`;
                    }
                  }).pipe(Effect.provide(nodeSqliteLayer(statePath))),
                );

                const failure = yield* Effect.scoped(
                  Effect.gen(function* () {
                    yield* RepositorySql;
                    return null;
                  }).pipe(
                    Effect.provide(
                      repositorySqlLayer({ commonDirectory: stateDirectory, statePath }),
                    ),
                  ),
                ).pipe(Effect.flip);
                expect(failure).toBeInstanceOf(RepositoryRestoredTransientState);
                if (!(failure instanceof RepositoryRestoredTransientState)) return;
                expect(failure.tasks).toEqual([
                  {
                    id: "BY-1",
                    numericId: 1,
                    title: "Restored Task",
                    state,
                    changeId: linked ? "change-linked" : null,
                  },
                ]);
                expect(failure.changes).toEqual([]);
              }
            }
          }),
        (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
      ),
  );

  it.effect("stops a restored database containing a retired Change state", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          yield* Effect.scoped(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              yield* migrateTestRepositoryThrough(22);
              yield* sql`INSERT INTO changes (id, repository_common_directory, branch_ref, task_id, state, created_at, updated_at, cleanup_state) VALUES ('change-blocked', ${directory}, 'refs/heads/blocked', NULL, 'blocked', '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z', 'complete')`;
            }).pipe(Effect.provide(nodeSqliteLayer(statePath))),
          );

          const failure = yield* Effect.scoped(
            Effect.gen(function* () {
              yield* RepositorySql;
              return null;
            }).pipe(
              Effect.provide(
                repositorySqlLayer({
                  commonDirectory: directory,
                  statePath,
                  lifecycle: "initialize",
                }),
              ),
            ),
          ).pipe(Effect.flip);
          expect(failure).toBeInstanceOf(RepositoryRestoredTransientState);
          if (!(failure instanceof RepositoryRestoredTransientState)) return;
          expect(failure.tasks).toEqual([]);
          expect(failure.changes).toEqual([
            { id: "change-blocked", taskId: null, state: "blocked" },
          ]);
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.effect("preserves supported merged Done records while removing legacy columns", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          yield* Effect.scoped(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              yield* migrateTestRepositoryThrough(12);
              yield* sql`
                    INSERT INTO tasks (
                      id, numeric_id, title, description, state, completion_kind, created_at, updated_at
                    ) VALUES (
                      'BY-1', 1, 'Merged Done Task', 'Must survive migration.',
                      'done', 'merged_pr', '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z'
                    )
                  `;
              yield* sql`
                    INSERT INTO changes (
                      id, repository_common_directory, branch_ref, task_id, state, close_reason,
                      created_at, updated_at, closed_at, base_ref, base_remote_url,
                      starting_commit, worktree_path, acceptance_context
                    ) VALUES (
                      'change-supported-merged', ${directory}, 'refs/heads/supported-merged',
                      'BY-1', 'closed', 'completed', '2026-07-25T16:30:00.000Z',
                      '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z',
                      'refs/remotes/origin/main', 'https://github.com/acme/repo.git', 'base-sha',
                      ${join(directory, "supported-merged")},
                      '{"version":1,"title":"Merged Done Task","description":"Must survive migration."}'
                    )
                  `;
            }).pipe(Effect.provide(nodeSqliteLayer(statePath))),
          );

          yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              const tasks = yield* repository.operation(
                "read migrated supported Task",
                (sql) => sql<{ readonly state: string }>`SELECT state FROM tasks WHERE id = 'BY-1'`,
              );
              const changes = yield* repository.operation(
                "read migrated supported Change",
                (sql) =>
                  sql<{ readonly state: string; readonly close_reason: string }>`
                    SELECT state, close_reason FROM changes WHERE id = 'change-supported-merged'
                  `,
              );
              const taskColumns = yield* repository.operation(
                "read migrated Task columns",
                (sql) => sql<{ readonly name: string }>`PRAGMA table_info(tasks)`,
              );
              const changeColumns = yield* repository.operation(
                "read migrated Change columns",
                (sql) => sql<{ readonly name: string }>`PRAGMA table_info(changes)`,
              );
              expect(tasks).toEqual([{ state: "done" }]);
              expect(changes).toEqual([{ state: "closed", close_reason: "completed" }]);
              expect(taskColumns.map(({ name }) => name)).not.toContain("completion_kind");
              expect(changeColumns.map(({ name }) => name)).not.toContain("no_change_candidate_id");
              expect(changeColumns.map(({ name }) => name)).not.toContain(
                "no_change_validation_run_id",
              );
            }).pipe(
              Effect.provide(
                repositorySqlLayer({
                  commonDirectory: directory,
                  statePath,
                  lifecycle: "initialize",
                }),
              ),
            ),
          );
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.effect("repairs only affected current Validation Policy Snapshot rows on upgrade", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          const buildAffectedPolicy = (instructions: string, acceptanceModel: string) => ({
            agentEnvironment: ["nix", "develop", "-c"] as const,
            prepare: { command: "pnpm install", timeoutSeconds: 60 },
            checks: [{ id: "types", command: "pnpm typecheck", timeoutSeconds: 30 }],
            copyFiles: [".env.test"],
            specialistReviews: [
              {
                id: "security",
                instructions: "Review security.",
                instructionsSource: "repo" as const,
                profile: {
                  agentProfile: "security",
                  scope: "repo" as const,
                  profile: {
                    agentRuntime: "pi" as const,
                    runtimeConfig: { model: "security-model" },
                  },
                },
              },
            ],
            acceptanceReview: {
              instructions,
              instructionsSource: "built_in" as const,
              profile: {
                agentProfile: "acceptance",
                scope: "global" as const,
                profile: {
                  agentRuntime: "pi" as const,
                  runtimeConfig: { model: acceptanceModel },
                },
              },
            },
            acceptanceContext: {
              version: 1 as const,
              title: "Keep the exact intent",
              description: "Review the Candidate against this immutable context.",
            },
          });
          const affectedPolicy = buildAffectedPolicy(
            "Review against the accepted intent.",
            "acceptance-model",
          );
          const reorderedAffectedPolicy = buildAffectedPolicy(
            "Reordered acceptance instructions.",
            "acceptance-reordered-model",
          );
          const affectedCorrectedText = encodeSqliteCandidateValidationPolicy(affectedPolicy);
          const affectedBuggyText = affectedCorrectedText.replace(
            '"acceptanceReview":{',
            '"acceptanceReview":{"ok":true,',
          );
          const reorderedAffectedBuggyText = JSON.stringify({
            ...reorderedAffectedPolicy,
            acceptanceReview: {
              profile: reorderedAffectedPolicy.acceptanceReview.profile,
              ok: true,
              instructions: reorderedAffectedPolicy.acceptanceReview.instructions,
              instructionsSource: reorderedAffectedPolicy.acceptanceReview.instructionsSource,
            },
          });
          const protoAffectedBuggyText = affectedBuggyText.replace(
            '"instructionsSource":"built_in"',
            '"instructionsSource":"built_in","__proto__":{"polluted":true}',
          );
          const whitespaceAffectedBuggyText = `{\n${affectedBuggyText.slice(1)}`;
          const currentPolicy = { checks: [], copyFiles: [], specialistReviews: [] };
          const currentPolicyText = JSON.stringify(currentPolicy);
          const legacyPolicyText =
            '{"checks":[],"copyFiles":[],"specialistReviews":[{"id":"s","instructions":"i","instructionsSource":"repo","agentProfile":"a","profileScope":"repo","profile":{"agentProfile":"a","scope":"repo","profile":{"agentRuntime":"pi"}}}]}';
          const malformedPolicyText = '{"checks":';

          yield* Effect.scoped(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              yield* migrateTestRepositoryThrough(24);
              yield* sql`
                INSERT INTO changes (
                  id, repository_common_directory, branch_ref, state, created_at, updated_at, cleanup_state
                ) VALUES (
                  'change-repair', ${directory}, 'refs/heads/repair', 'open',
                  '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z', 'complete'
                )
              `;
              yield* sql`
                INSERT INTO candidates (id, change_id, change_base_sha, head_sha, created_at)
                VALUES ('candidate-repair', 'change-repair', 'base-sha', 'head-sha', '2026-07-25T16:31:00.000Z')
              `;
              for (const run of [
                {
                  id: "run-affected",
                  policy: affectedBuggyText,
                  now: "2026-07-25T16:32:00.000Z",
                },
                {
                  id: "run-affected-reordered",
                  policy: reorderedAffectedBuggyText,
                  now: "2026-07-25T16:32:00.500Z",
                },
                {
                  id: "run-proto",
                  policy: protoAffectedBuggyText,
                  now: "2026-07-25T16:32:00.750Z",
                },
                {
                  id: "run-whitespace",
                  policy: whitespaceAffectedBuggyText,
                  now: "2026-07-25T16:32:00.875Z",
                },
                { id: "run-legacy", policy: legacyPolicyText, now: "2026-07-25T16:32:01.000Z" },
                {
                  id: "run-malformed",
                  policy: malformedPolicyText,
                  now: "2026-07-25T16:32:02.000Z",
                },
                { id: "run-current", policy: currentPolicyText, now: "2026-07-25T16:32:03.000Z" },
              ] as const) {
                yield* sql`
                  INSERT INTO candidate_validation_runs (
                    id, candidate_id, policy_snapshot, implementation_decisions,
                    latest_resolved_blocker_id, state, outcome, created_at, updated_at
                  ) VALUES (
                    ${run.id}, 'candidate-repair', ${run.policy}, '[]', NULL,
                    'complete', 'passed', ${run.now}, ${run.now}
                  )
                `;
              }
            }).pipe(Effect.provide(nodeSqliteLayer(statePath))),
          );

          yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              const rows = yield* repository.operation(
                "read repaired Validation Policy Snapshot text",
                (sql) => sql<{ readonly id: string; readonly policySnapshot: string }>`
                  SELECT id, policy_snapshot AS policySnapshot
                  FROM candidate_validation_runs
                  ORDER BY created_at
                `,
              );
              const retiredAdmissionTables = yield* repository.operation(
                "confirm retired validation admission storage is absent",
                (sql) => sql<{ readonly name: string }>`
                  SELECT name FROM sqlite_schema
                  WHERE type = 'table' AND name = 'candidate_validation_admissions'
                `,
              );
              expect(retiredAdmissionTables).toEqual([]);
              const byId = new Map(rows.map((row) => [row.id, row.policySnapshot]));
              expect(byId.get("run-affected")).toBe(affectedCorrectedText);
              expect(byId.get("run-affected-reordered")).toBe(reorderedAffectedBuggyText);
              expect(byId.get("run-proto")).toBe(protoAffectedBuggyText);
              expect(byId.get("run-whitespace")).toBe(whitespaceAffectedBuggyText);
              expect(byId.get("run-legacy")).toBe(legacyPolicyText);
              expect(byId.get("run-malformed")).toBe(malformedPolicyText);
              expect(byId.get("run-current")).toBe(currentPolicyText);
            }).pipe(
              Effect.provide(
                repositorySqlLayer({
                  commonDirectory: directory,
                  statePath,
                  lifecycle: "initialize",
                }),
              ),
            ),
          );
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.effect("upgrades a Taskless Change with cancellation reason storage", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          yield* Effect.scoped(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              yield* migrateTestRepositoryThrough(21);
              yield* sql`
                INSERT INTO changes (
                  id, repository_common_directory, branch_ref, state, created_at, updated_at,
                  cleanup_state, base_ref, base_remote_url, starting_commit, worktree_path
                ) VALUES (
                  'change-cancel-upgrade', ${directory}, 'refs/heads/cancel-upgrade', 'open',
                  '2026-07-17T23:00:00.000Z', '2026-07-17T23:00:00.000Z', 'complete',
                  'refs/remotes/origin/main', 'https://github.com/acme/repo.git',
                  '1111111111111111111111111111111111111111', ${join(directory, "worktree")}
                )
              `;
            }).pipe(Effect.provide(nodeSqliteLayer(statePath))),
          );

          yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              const rows = yield* repository.operation(
                "read migrated Taskless Change cancellation facts",
                (sql) => sql<{
                  readonly id: string;
                  readonly taskId: string | null;
                  readonly state: string;
                  readonly cancelReason: string | null;
                }>`
                  SELECT id, task_id AS taskId, state, cancel_reason AS cancelReason
                  FROM changes WHERE id = 'change-cancel-upgrade'
                `,
              );
              expect(rows).toEqual([
                {
                  id: "change-cancel-upgrade",
                  taskId: null,
                  state: "open",
                  cancelReason: null,
                },
              ]);
              const columns = yield* repository.operation(
                "read migrated Change cancellation columns",
                (sql) => sql<{ readonly name: string }>`PRAGMA table_info(changes)`,
              );
              expect(columns.map(({ name }) => name)).toContain("cancel_reason");
            }).pipe(
              Effect.provide(
                repositorySqlLayer({
                  commonDirectory: directory,
                  statePath,
                  lifecycle: "initialize",
                }),
              ),
            ),
          );
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.effect("drops Finding severity while preserving supported Findings", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          yield* Effect.scoped(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              yield* migrateTestRepositoryThrough(17);
              yield* sql`
                    INSERT INTO changes (
                      id, repository_common_directory, branch_ref, state,
                      created_at, updated_at
                    ) VALUES (
                      'change-severity', ${directory}, 'refs/heads/severity',
                      'open', '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z'
                    )
                  `;
              yield* sql`
                    INSERT INTO candidates (
                      id, change_id, change_base_sha, head_sha, created_at
                    ) VALUES (
                      'candidate-severity', 'change-severity', 'base-sha', 'head-sha',
                      '2026-07-25T16:30:00.000Z'
                    )
                  `;
              yield* sql`
                    INSERT INTO candidate_validation_runs (
                      id, candidate_id, policy_snapshot, state, outcome,
                      created_at, updated_at
                    ) VALUES (
                      'run-severity', 'candidate-severity',
                      '{"checks":[{"id":"quality","command":"just quality","timeoutSeconds":60}],"copyFiles":[]}',
                      'complete', 'passed',
                      '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z'
                    )
                  `;
              yield* sql`
                    INSERT INTO candidate_validation_rounds (
                      validation_run_id, phase, producer, round_number, status, created_at
                    ) VALUES (
                      'run-severity', 'checks', 'quality', 1, 'failed',
                      '2026-07-25T16:30:00.000Z'
                    )
                  `;
              yield* sql`
                    INSERT INTO candidate_validation_findings (
                      id, validation_run_id, phase, producer, title, description, severity,
                      evidence, files, artifact_refs, created_at, updated_at
                    ) VALUES (
                      'finding-severity', 'run-severity', 'checks', 'quality',
                      'Historical Check Finding', 'Remains readable after migration.', 'high',
                      'exitCode: 1', '[]', '[]',
                      '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z'
                    )
                  `;
            }).pipe(Effect.provide(nodeSqliteLayer(statePath))),
          );

          yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              const findings = yield* repository.operation(
                "read migrated Findings",
                (sql) => sql<{
                  readonly id: string;
                  readonly validationRunId: string;
                  readonly phase: string;
                  readonly producer: string;
                  readonly title: string;
                  readonly description: string;
                  readonly evidence: string;
                  readonly files: string;
                  readonly artifactRefs: string;
                  readonly createdAt: string;
                  readonly updatedAt: string;
                }>`
                  SELECT id, validation_run_id AS validationRunId, phase, producer, title,
                    description, evidence, files, artifact_refs AS artifactRefs,
                    created_at AS createdAt, updated_at AS updatedAt
                  FROM candidate_validation_findings
                  WHERE validation_run_id = 'run-severity'
                `,
              );
              expect(findings).toEqual([
                {
                  id: "finding-severity",
                  validationRunId: "run-severity",
                  phase: "checks",
                  producer: "quality",
                  title: "Historical Check Finding",
                  description: "Remains readable after migration.",
                  evidence: "exitCode: 1",
                  files: "[]",
                  artifactRefs: "[]",
                  createdAt: "2026-07-25T16:30:00.000Z",
                  updatedAt: "2026-07-25T16:30:00.000Z",
                },
              ]);
              const findingColumns = yield* repository.operation(
                "read migrated Finding columns",
                (sql) =>
                  sql<{ readonly name: string }>`PRAGMA table_info(candidate_validation_findings)`,
              );
              expect(findingColumns.map(({ name }) => name)).not.toContain("severity");
            }).pipe(
              Effect.provide(
                repositorySqlLayer({
                  commonDirectory: directory,
                  statePath,
                  lifecycle: "initialize",
                }),
              ),
            ),
          );
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.effect("drops retired Reviewer Session fields while preserving supported sessions", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          yield* Effect.scoped(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              yield* migrateTestRepositoryThrough(18);
              yield* sql`
                      INSERT INTO changes (
                        id, repository_common_directory, branch_ref, state,
                        created_at, updated_at
                      ) VALUES (
                        'change-session', ${directory}, 'refs/heads/session',
                        'open', '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z'
                      )
                    `;
              yield* sql`
                      INSERT INTO reviewer_sessions (
                        change_id, producer, identity, fingerprint, session_reference,
                        last_candidate_id, updated_at
                      ) VALUES (
                        'change-session', 'acceptance', 'not-json',
                        'fingerprint-legacy', 'session-legacy',
                        'candidate-legacy', '2026-07-25T16:30:00.000Z'
                      )
                    `;
            }).pipe(Effect.provide(nodeSqliteLayer(statePath))),
          );

          yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              const sessions = yield* repository.operation(
                "read migrated Reviewer Sessions",
                (sql) => sql<{
                  readonly changeId: string;
                  readonly producer: string;
                  readonly fingerprint: string;
                  readonly sessionReference: string;
                }>`
                  SELECT change_id AS changeId, producer, fingerprint,
                    session_reference AS sessionReference
                  FROM reviewer_sessions WHERE change_id = 'change-session'
                `,
              );
              expect(sessions).toEqual([
                {
                  changeId: "change-session",
                  producer: "acceptance",
                  fingerprint: "fingerprint-legacy",
                  sessionReference: "session-legacy",
                },
              ]);
              const sessionColumns = yield* repository.operation(
                "read migrated Reviewer Session columns",
                (sql) => sql<{ readonly name: string }>`PRAGMA table_info(reviewer_sessions)`,
              );
              expect(sessionColumns.map(({ name }) => name)).toEqual([
                "change_id",
                "producer",
                "fingerprint",
                "session_reference",
              ]);
              const indexRows = yield* repository.operation(
                "read migrated Reviewer Session indexes",
                (sql) =>
                  sql<{ readonly name: string }>`
                    SELECT name FROM sqlite_master
                    WHERE type = 'index' AND name = 'reviewer_sessions_fingerprint_idx'
                  `,
              );
              expect(indexRows).toEqual([]);
            }).pipe(
              Effect.provide(
                repositorySqlLayer({
                  commonDirectory: directory,
                  statePath,
                  lifecycle: "initialize",
                }),
              ),
            ),
          );
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.effect("preserves active Reviewer Sessions while adding Reviewer Transcript storage", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          yield* Effect.scoped(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              yield* migrateTestRepositoryThrough(20);
              yield* sql`
                    INSERT INTO changes (
                      id, repository_common_directory, branch_ref, state,
                      created_at, updated_at
                    ) VALUES (
                      'change-session-retained', ${directory}, 'refs/heads/retained',
                      'open', '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z'
                    )
                  `;
              yield* sql`
                    INSERT INTO reviewer_sessions (
                      change_id, producer, fingerprint, session_reference
                    ) VALUES (
                      'change-session-retained', 'acceptance', 'fingerprint-retained', 'session-1'
                    )
                  `;
            }).pipe(Effect.provide(nodeSqliteLayer(statePath))),
          );

          yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              const sessions = yield* repository.operation(
                "read preserved Reviewer Sessions",
                (sql) => sql<{
                  readonly changeId: string;
                  readonly producer: string;
                  readonly fingerprint: string;
                  readonly sessionReference: string;
                }>`
                  SELECT change_id AS changeId, producer, fingerprint,
                    session_reference AS sessionReference
                  FROM reviewer_sessions WHERE change_id = 'change-session-retained'
                `,
              );
              expect(sessions).toEqual([
                {
                  changeId: "change-session-retained",
                  producer: "acceptance",
                  fingerprint: "fingerprint-retained",
                  sessionReference: "session-1",
                },
              ]);
              yield* repository.operation(
                "write migrated Reviewer Transcript",
                (sql) => sql`
                INSERT INTO reviewer_transcripts (change_id, producer, pi_session_id, file_path)
                VALUES (
                  'change-session-retained', 'acceptance', 'session-1',
                  'reviewer-sessions/review_session-1.jsonl'
                )
              `,
              );
              const transcripts = yield* repository.operation(
                "read migrated Reviewer Transcripts",
                (sql) => sql<{
                  readonly changeId: string;
                  readonly producer: string;
                  readonly piSessionId: string;
                  readonly filePath: string;
                }>`
                  SELECT change_id AS changeId, producer, pi_session_id AS piSessionId,
                    file_path AS filePath
                  FROM reviewer_transcripts WHERE change_id = 'change-session-retained'
                `,
              );
              expect(transcripts).toEqual([
                {
                  changeId: "change-session-retained",
                  producer: "acceptance",
                  piSessionId: "session-1",
                  filePath: "reviewer-sessions/review_session-1.jsonl",
                },
              ]);
              const migrations = yield* repository.operation(
                "read re-applied Reviewer Transcript migration",
                (sql) =>
                  sql<{ readonly name: string }>`
                    SELECT name FROM effect_sql_migrations WHERE migration_id IN (21, 22)
                  `,
              );
              expect(migrations).toEqual([
                { name: "reviewer_transcripts" },
                { name: "change_cancel_reason" },
              ]);
            }).pipe(
              Effect.provide(
                repositorySqlLayer({
                  commonDirectory: directory,
                  statePath,
                  lifecycle: "initialize",
                }),
              ),
            ),
          );
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.effect("stops migration with Task and Change facts for unsupported No-Change records", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          yield* Effect.scoped(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              yield* migrateTestRepositoryThrough(12);
              yield* sql`
                    INSERT INTO tasks (
                      id, numeric_id, title, description, state, completion_kind, created_at, updated_at
                    ) VALUES (
                      'BY-1', 1, 'Unsupported No-Change Task', 'Must stop migration.',
                      'done', 'no_change', '2026-07-25T17:00:00.000Z', '2026-07-25T17:00:00.000Z'
                    )
                  `;
              yield* sql`
                    INSERT INTO changes (
                      id, repository_common_directory, branch_ref, task_id, state,
                      created_at, updated_at, base_ref, base_remote_url, starting_commit,
                      worktree_path, acceptance_context,
                      no_change_candidate_id, no_change_validation_run_id
                    ) VALUES (
                      'change-unsupported-no-change', ${directory}, 'refs/heads/unsupported-no-change',
                      'BY-1', 'open', '2026-07-25T17:00:00.000Z', '2026-07-25T17:00:00.000Z',
                      'refs/remotes/origin/main', 'https://github.com/acme/repo.git', 'base-sha',
                      ${join(directory, "unsupported-no-change")},
                      '{"version":1,"title":"Unsupported No-Change Task","description":"Must stop migration."}',
                      'candidate-unsupported', 'run-unsupported'
                    )
                  `;
            }).pipe(Effect.provide(nodeSqliteLayer(statePath))),
          );

          const error = yield* Effect.scoped(
            RepositorySql.pipe(
              Effect.provide(
                repositorySqlLayer({
                  commonDirectory: directory,
                  statePath,
                  lifecycle: "initialize",
                }),
              ),
            ),
          ).pipe(Effect.flip);

          expect(error).toBeInstanceOf(RepositoryMigrationFailed);
          const migrationError = Array.from(
            Cause.defects(error.cause as Cause.Cause<unknown>),
          )[0] as {
            readonly cause?: unknown;
          };
          expect(String(migrationError.cause)).toContain("taskId=BY-1 taskState=done");
          expect(String(migrationError.cause)).toContain("changeId=change-unsupported-no-change");
          expect(String(migrationError.cause)).toContain("candidateId=candidate-unsupported");
          expect(String(migrationError.cause)).toContain("validationRunId=run-unsupported");
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.effect("preserves supported Change data while removing persisted readiness", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          yield* Effect.scoped(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              yield* migrateTestRepositoryThrough(13);
              yield* sql`
                    INSERT INTO changes (
                      id, repository_common_directory, branch_ref, state, created_at, updated_at,
                      base_ref, base_remote_url, starting_commit, worktree_path,
                      readiness, prepare_command, prepare_timeout_seconds, prepare_failure
                    ) VALUES (
                      'change-with-failure', ${directory}, 'refs/heads/with-failure', 'open',
                      '2026-07-25T17:30:00.000Z', '2026-07-25T17:30:00.000Z',
                      'refs/remotes/origin/main', 'https://github.com/acme/repo.git', 'base-sha',
                      ${join(directory, "worktree")}, 'prepare_failed', 'just prepare', 1200,
                      '{"command":"just prepare","exitCode":7,"timedOut":false,"stdout":"","stderr":"failed"}'
                    )
                  `;
            }).pipe(Effect.provide(nodeSqliteLayer(statePath))),
          );

          yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              const changeColumns = yield* repository.operation(
                "read migrated Change columns",
                (sql) => sql<{ readonly name: string }>`PRAGMA table_info(changes)`,
              );
              expect(changeColumns.map(({ name }) => name)).not.toContain("readiness");
              const stored = yield* repository.operation(
                "read migrated Change preparation facts",
                (sql) => sql<{
                  readonly id: string;
                  readonly state: string;
                  readonly baseRef: string;
                  readonly worktreePath: string;
                  readonly prepareCommand: string;
                  readonly prepareTimeoutSeconds: number;
                  readonly prepareFailure: string;
                }>`
                  SELECT id, state, base_ref AS baseRef, worktree_path AS worktreePath,
                    prepare_command AS prepareCommand,
                    prepare_timeout_seconds AS prepareTimeoutSeconds,
                    prepare_failure AS prepareFailure
                  FROM changes WHERE id = 'change-with-failure'
                `,
              );
              expect(stored).toEqual([
                {
                  id: "change-with-failure",
                  state: "open",
                  baseRef: "refs/remotes/origin/main",
                  worktreePath: join(directory, "worktree"),
                  prepareCommand: "just prepare",
                  prepareTimeoutSeconds: 1200,
                  prepareFailure:
                    '{"command":"just prepare","exitCode":7,"timedOut":false,"stdout":"","stderr":"failed"}',
                },
              ]);
            }).pipe(
              Effect.provide(
                repositorySqlLayer({
                  commonDirectory: directory,
                  statePath,
                  lifecycle: "initialize",
                }),
              ),
            ),
          );
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.effect(
    "removes Acceptance Context version history while preserving current context and snapshots",
    () =>
      Effect.acquireUseRelease(
        Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
        (directory) =>
          Effect.gen(function* () {
            const statePath = join(directory, "state.sqlite");
            yield* Effect.scoped(
              Effect.gen(function* () {
                const sql = yield* SqlClient.SqlClient;
                yield* migrateTestRepositoryThrough(14);
                yield* sql`
                      INSERT INTO tasks (
                        id, numeric_id, title, description, state, cancel_reason,
                        created_at, updated_at
                      ) VALUES (
                        'BY-1', 1, 'Current intent', 'Must survive.', 'todo', NULL,
                        '2026-07-25T18:00:00.000Z', '2026-07-25T18:00:00.000Z'
                      )
                    `;
                yield* sql`
                      INSERT INTO changes (
                        id, repository_common_directory, branch_ref, task_id, state, close_reason,
                        created_at, updated_at, closed_at, acceptance_context, base_ref,
                        base_remote_url, starting_commit, worktree_path
                      ) VALUES (
                        'change-with-context', ${directory}, 'refs/heads/with-context', 'BY-1',
                        'open', NULL, '2026-07-25T18:00:00.000Z', '2026-07-25T18:00:00.000Z',
                        NULL,
                        '{"version":1,"title":"Current intent","description":"Must survive.","comments":["Historical Task comment."]}',
                        'refs/remotes/origin/main', 'https://github.test/acme/repo.git',
                        'base-sha', ${join(directory, "worktree")}
                      )
                    `;
                yield* sql`
                      INSERT INTO acceptance_context_versions (change_id, version, context, created_at)
                      VALUES (
                        'change-with-context', 1,
                        '{"version":1,"title":"Current intent","description":"Must survive.","comments":["Historical Task comment."]}',
                        '2026-07-25T18:00:00.000Z'
                      )
                    `;
                yield* sql`
                      INSERT INTO candidates (id, change_id, change_base_sha, head_sha, created_at)
                      VALUES ('candidate-1', 'change-with-context', 'base-sha', 'head-sha', '2026-07-25T18:01:00.000Z')
                    `;
                yield* sql`
                      INSERT INTO candidate_validation_runs (
                        id, candidate_id, policy_snapshot, state, outcome, created_at, updated_at
                      ) VALUES (
                        'run-1', 'candidate-1',
                        '{"checks":[],"copyFiles":[],"specialistReviews":[],"acceptanceContext":{"version":1,"title":"Current intent","description":"Must survive.","comments":["Historical Task comment."]}}',
                        'complete', 'passed', '2026-07-25T18:02:00.000Z', '2026-07-25T18:02:00.000Z'
                      )
                    `;
              }).pipe(Effect.provide(nodeSqliteLayer(statePath))),
            );

            yield* Effect.scoped(
              Effect.gen(function* () {
                const repository = yield* RepositorySql;
                const tables = yield* repository.operation(
                  "read migrated Acceptance Context version tables",
                  (sql) => sql<{ readonly name: string }>`
                    SELECT name FROM sqlite_master
                    WHERE type = 'table' AND name = 'acceptance_context_versions'
                  `,
                );
                expect(tables).toEqual([]);
                const stored = yield* repository.operation(
                  "read preserved Acceptance Context",
                  (sql) => sql<{ readonly acceptanceContext: string }>`
                    SELECT acceptance_context AS acceptanceContext
                    FROM changes WHERE id = 'change-with-context'
                  `,
                );
                expect(stored).toEqual([
                  {
                    acceptanceContext:
                      '{"version":1,"title":"Current intent","description":"Must survive.","comments":["Historical Task comment."]}',
                  },
                ]);
                const runs = yield* repository.operation(
                  "read preserved Validation Run snapshot",
                  (sql) => sql<{ readonly policySnapshot: string }>`
                    SELECT policy_snapshot AS policySnapshot
                    FROM candidate_validation_runs WHERE id = 'run-1'
                  `,
                );
                expect(runs).toEqual([
                  {
                    policySnapshot:
                      '{"checks":[],"copyFiles":[],"specialistReviews":[],"acceptanceContext":{"version":1,"title":"Current intent","description":"Must survive.","comments":["Historical Task comment."]}}',
                  },
                ]);
              }).pipe(
                Effect.provide(
                  repositorySqlLayer({
                    commonDirectory: directory,
                    statePath,
                    lifecycle: "initialize",
                  }),
                ),
              ),
            );
          }),
        (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
      ),
  );

  it.effect("deletes legacy-only Implementation Decisions and preserves structured rows", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          yield* Effect.scoped(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              yield* migrateTestRepositoryThrough(15);
              yield* sql`
                    INSERT INTO changes (
                      id, repository_common_directory, branch_ref, state, close_reason,
                      created_at, updated_at, closed_at
                    ) VALUES (
                      'change-decisions', ${directory}, 'refs/heads/decisions',
                      'open', NULL, '2026-07-25T18:30:00.000Z', '2026-07-25T18:30:00.000Z', NULL
                    )
                  `;
              yield* sql`
                    INSERT INTO implementation_decisions (
                      id, change_id, recorded_at, content, choice, rationale
                    ) VALUES (
                      'structured-decision', 'change-decisions', '2026-07-25T18:31:00.000Z',
                      '', 'Structured choice', 'Structured rationale'
                    )
                  `;
              yield* sql`
                    INSERT INTO implementation_decisions (
                      id, change_id, recorded_at, content
                    ) VALUES (
                      'legacy-decision', 'change-decisions', '2026-07-25T18:32:00.000Z',
                      'Legacy unstructured decision'
                    )
                  `;
            }).pipe(Effect.provide(nodeSqliteLayer(statePath))),
          );

          yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              const decisions = yield* repository.operation(
                "read migrated Implementation Decisions",
                (sql) => sql<{
                  readonly id: string;
                  readonly changeId: string;
                  readonly sequence: number;
                  readonly recordedAt: string;
                  readonly choice: string;
                  readonly rationale: string;
                }>`
                  SELECT id, change_id AS changeId, sequence, recorded_at AS recordedAt,
                    choice, rationale
                  FROM implementation_decisions WHERE change_id = 'change-decisions'
                  ORDER BY sequence
                `,
              );
              expect(decisions).toEqual([
                {
                  id: "structured-decision",
                  changeId: "change-decisions",
                  sequence: 1,
                  recordedAt: "2026-07-25T18:31:00.000Z",
                  choice: "Structured choice",
                  rationale: "Structured rationale",
                },
              ]);
              const decisionColumns = yield* repository.operation(
                "read migrated Implementation Decision columns",
                (sql) =>
                  sql<{ readonly name: string }>`PRAGMA table_info(implementation_decisions)`,
              );
              expect(decisionColumns.map(({ name }) => name)).not.toContain("content");
              const migrations = yield* repository.operation(
                "read re-run migration",
                (sql) =>
                  sql<{ readonly name: string }>`
                    SELECT name FROM effect_sql_migrations WHERE migration_id = 16
                  `,
              );
              expect(migrations).toEqual([{ name: "remove_implementation_decision_content" }]);
            }).pipe(
              Effect.provide(
                repositorySqlLayer({
                  commonDirectory: directory,
                  statePath,
                  lifecycle: "initialize",
                }),
              ),
            ),
          );
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.effect("stops migration with Decision and Change facts for malformed partial rows", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          yield* Effect.scoped(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              yield* migrateTestRepositoryThrough(15);
              yield* sql`
                    INSERT INTO changes (
                      id, repository_common_directory, branch_ref, state, close_reason,
                      created_at, updated_at, closed_at
                    ) VALUES (
                      'change-partial', ${directory}, 'refs/heads/partial',
                      'open', NULL, '2026-07-25T18:40:00.000Z', '2026-07-25T18:40:00.000Z', NULL
                    )
                  `;
              yield* sql`
                    INSERT INTO implementation_decisions (
                      id, change_id, recorded_at, content, choice, rationale
                    ) VALUES (
                      'partial-decision', 'change-partial', '2026-07-25T18:41:00.000Z',
                      'Legacy text', 'Partial choice', NULL
                    )
                  `;
            }).pipe(Effect.provide(nodeSqliteLayer(statePath))),
          );

          const error = yield* Effect.scoped(
            RepositorySql.pipe(
              Effect.provide(
                repositorySqlLayer({
                  commonDirectory: directory,
                  statePath,
                  lifecycle: "initialize",
                }),
              ),
            ),
          ).pipe(Effect.flip);

          expect(error).toBeInstanceOf(RepositoryMigrationFailed);
          const migrationError = Array.from(
            Cause.defects(error.cause as Cause.Cause<unknown>),
          )[0] as {
            readonly cause?: unknown;
          };
          expect(String(migrationError.cause)).toContain("decisionId=partial-decision");
          expect(String(migrationError.cause)).toContain("changeId=change-partial");
          expect(String(migrationError.cause)).toContain("without inventing Choice or Rationale");
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.scoped("drops empty retired Snapshot Workspace cleanup state", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* createPreNativeCleanupTable;
      yield* removePreNativeSnapshotWorkspaceCleanupMigration;

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_schema
        WHERE type = 'table' AND name = 'pre_native_snapshot_workspace_cleanups'
      `;
      expect(tables).toEqual([]);
    }).pipe(Effect.provide(nodeSqliteLayer(":memory:"))),
  );

  it.scoped("stops before deleting retained Snapshot Workspace cleanup identity", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* createPreNativeCleanupTable;
      yield* sql.unsafe(`
        INSERT INTO pre_native_snapshot_workspace_cleanups (
          validation_run_id, retired_ref_name, workspace_path, expected_commit_sha
        ) VALUES (
          'run-1', 'refs/but-why/validation-runs/run-1/validation',
          '/repo/.sandcastle/worktrees/run-1', 'candidate-sha'
        )
      `);

      const error = yield* Effect.flip(removePreNativeSnapshotWorkspaceCleanupMigration);
      expect(error).toEqual(
        new Error(
          "Pre-native Snapshot Workspace cleanup identity remains in Shared Repository State",
        ),
      );
      const rows = yield* sql<{ readonly validationRunId: string }>`
        SELECT validation_run_id AS validationRunId
        FROM pre_native_snapshot_workspace_cleanups
      `;
      expect(rows).toEqual([{ validationRunId: "run-1" }]);
    }).pipe(Effect.provide(nodeSqliteLayer(":memory:"))),
  );

  it.effect("migrates every Task Review policy snapshot to one unversioned shape", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          yield* Effect.scoped(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              yield* migrateTestRepositoryThrough(35);
              yield* sql`
                INSERT INTO tasks (
                  id, numeric_id, title, description, state, cancel_reason, created_at, updated_at
                ) VALUES (
                  'BY-1', 1, 'Reviewed', 'Historical proposal', 'new', NULL,
                  '2026-08-12T08:00:00.000Z', '2026-08-12T08:00:00.000Z'
                )
              `;
              for (const [id, policy] of [
                [
                  "review-v1",
                  {
                    id: "task_advisory_review",
                    version: 1,
                    agentProfile: "legacy",
                    profileScope: "global",
                    instructions: "Legacy instructions",
                  },
                ],
                [
                  "review-v2",
                  {
                    id: "task_advisory_review",
                    version: 2,
                    profile: {
                      agentProfile: "review",
                      scope: "global",
                      profile: { agentRuntime: "pi", runtimeConfig: { model: "provider/model" } },
                    },
                    builtInInstructions: "Current instructions",
                    guidance: { content: "Guidance", source: "global" },
                  },
                ],
                [
                  "review-v3",
                  {
                    id: "task_review",
                    version: 3,
                    profile: {
                      agentProfile: "repo-review",
                      scope: "repo",
                      profile: { agentRuntime: "pi" },
                    },
                    builtInInstructions: "Current instructions",
                    guidance: null,
                  },
                ],
              ] as const) {
                yield* sql`
                  INSERT INTO task_reviews (
                    id, task_id, proposal_snapshot, dependency_evidence, policy_snapshot,
                    base_ref, base_commit, workspace_path, state, outcome, workspace_cleanup,
                    tooling_failure, abandon_reason, created_at, updated_at
                  ) VALUES (
                    ${id}, 'BY-1', '{"title":"Reviewed","description":"Historical proposal","dependencyIds":[]}',
                    '[]', ${JSON.stringify(policy)}, 'refs/heads/main', ${"a".repeat(40)},
                    ${`/tmp/${id}`}, 'complete', 'blocked', 'removed', NULL, NULL,
                    '2026-08-12T08:00:00.000Z', '2026-08-12T08:00:00.000Z'
                  )
                `;
              }
            }).pipe(Effect.provide(nodeSqliteLayer(statePath))),
          );

          const snapshots = yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              return yield* repository.operation(
                "read migrated Task Review policies",
                (sql) =>
                  sql<{ readonly id: string; readonly policySnapshot: string }>`
                  SELECT id, policy_snapshot AS policySnapshot FROM task_reviews ORDER BY id
                `,
              );
            }).pipe(
              Effect.provide(
                repositorySqlLayer({
                  commonDirectory: directory,
                  statePath,
                  lifecycle: "initialize",
                }),
              ),
            ),
          );

          expect(
            snapshots.map(({ id, policySnapshot }) => [id, JSON.parse(policySnapshot)]),
          ).toEqual([
            [
              "review-v1",
              {
                profile: {
                  agentProfile: "legacy",
                  scope: "global",
                  profile: null,
                },
                builtInInstructions: "Legacy instructions",
                guidance: null,
              },
            ],
            [
              "review-v2",
              {
                profile: {
                  agentProfile: "review",
                  scope: "global",
                  profile: { agentRuntime: "pi", runtimeConfig: { model: "provider/model" } },
                },
                builtInInstructions: "Current instructions",
                guidance: { content: "Guidance", source: "global" },
              },
            ],
            [
              "review-v3",
              {
                profile: {
                  agentProfile: "repo-review",
                  scope: "repo",
                  profile: { agentRuntime: "pi" },
                },
                builtInInstructions: "Current instructions",
                guidance: null,
              },
            ],
          ]);
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.effect("reports migration failures through the typed error channel", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          yield* Effect.scoped(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              yield* migrateTestRepositoryThrough(15);
              yield* sql`DROP TABLE implementation_decisions`;
              yield* sql`CREATE VIEW implementation_decisions AS SELECT 1 AS sequence`;
            }).pipe(Effect.provide(nodeSqliteLayer(statePath))),
          );

          const error = yield* Effect.scoped(
            RepositorySql.pipe(
              Effect.provide(
                repositorySqlLayer({
                  commonDirectory: directory,
                  statePath,
                }),
              ),
            ),
          ).pipe(Effect.flip);

          expect(error).toBeInstanceOf(RepositoryMigrationFailed);
          expect(error).toMatchObject({
            _tag: "RepositoryMigrationFailed",
            statePath,
          });
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );
});
