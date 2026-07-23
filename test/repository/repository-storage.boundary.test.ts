import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { storedPublicTaskId } from "../../src/task/taskId.js";
import { openSqliteChangeCandidateCapturePersistence } from "../../src/sqlite/sqliteChangeCandidateCapturePersistence.js";
import { openSqliteChangePersistence } from "../../src/sqlite/sqliteChangePersistence.js";
import { openSqliteChangeStartPersistence } from "../../src/sqlite/sqliteChangeStartPersistence.js";
import { openSqliteTaskPersistence } from "../../src/sqlite/sqliteTaskPersistence.js";
import {
  RepositoryIdentityConflict,
  RepositoryMigrationFailed,
  RepositoryPersistedDataInvalid,
  RepositorySqlOperationFailed,
  RepositoryStateUnavailable,
} from "../../src/repositoryStorageError.js";
import { RepositorySql, repositorySqlLayer } from "../../src/sqlite/repositorySql.js";
import { withTemporaryRepositoryState as withTemporaryState } from "../support/repository.js";

const migrationCount = Effect.gen(function* () {
  const repositorySql = yield* RepositorySql;
  const rows = yield* repositorySql.operation(
    "count repository migrations",
    (sql) => sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM effect_sql_migrations
    `,
  );
  return rows[0]?.count ?? -1;
});

describe("repository SQL storage", () => {
  it.scoped("persists Tasks through the Effect-native Task interface", () =>
    withTemporaryState(() =>
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence("BY");
        const created = yield* tasks.createTask({
          title: "Effect-native Task",
          description: "Persist this Task through repository SQL.",
          now: "2026-07-17T22:45:00.000Z",
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        const stored = yield* tasks.getTaskById(storedPublicTaskId(created.task.id));

        expect(stored).toMatchObject({
          id: "BY-1",
          title: "Effect-native Task",
          state: "new",
        });
      }),
    ),
  );

  it.scoped("rolls back Task-backed Change Start when the Task transition fails", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence("BY");
        const changes = yield* openSqliteChangeStartPersistence();
        const created = yield* tasks.createTask({
          title: "Atomic Change Start",
          description: "The Change and Task transition commit together.",
          now: "2026-07-17T22:50:00.000Z",
        });
        if (!created.ok) return;
        const taskId = storedPublicTaskId(created.task.id);
        yield* tasks.approveTask({ taskId, now: "2026-07-17T22:51:00.000Z" });

        const repository = yield* RepositorySql;
        yield* repository.operation(
          "install Task transition failure",
          (sql) => sql`
            CREATE TRIGGER reject_change_start_task_transition
            BEFORE UPDATE OF state ON tasks
            WHEN NEW.state = 'implementing'
            BEGIN
              SELECT RAISE(ABORT, 'deliberate Task transition failure');
            END
          `,
        );

        yield* changes
          .create({
            id: "change-atomic",
            repositoryCommonDirectory: input.commonDirectory,
            branchRef: "refs/heads/but-why/by-1",
            baseRef: "main",
            startingCommit: "1111111111111111111111111111111111111111",
            worktreePath: join(input.commonDirectory, "worktrees", "by-1"),
            taskId,
            now: "2026-07-17T22:52:00.000Z",
          })
          .pipe(Effect.flip);

        expect(yield* changes.getById("change-atomic")).toBeUndefined();
        expect(yield* tasks.getTaskById(taskId)).toMatchObject({ state: "todo" });
      }),
    ),
  );

  it.scoped("atomically completes a merged Task-backed Change", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence("BY");
        const starts = yield* openSqliteChangeStartPersistence();
        const changes = yield* openSqliteChangePersistence();
        const created = yield* tasks.createTask({
          title: "Complete merged Change",
          description: "Complete the Change and linked Task together.",
          now: "2026-07-17T22:55:00.000Z",
        });
        if (!created.ok) return;
        const taskId = storedPublicTaskId(created.task.id);
        yield* tasks.approveTask({ taskId, now: "2026-07-17T22:56:00.000Z" });
        const started = yield* starts.create({
          id: "change-complete",
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/but-why/by-1",
          baseRef: "main",
          startingCommit: "1111111111111111111111111111111111111111",
          worktreePath: join(input.commonDirectory, "worktrees", "by-1"),
          taskId,
          now: "2026-07-17T22:57:00.000Z",
        });
        if (!started.ok) return;

        const completed = yield* changes.completeMergedChange({
          changeId: started.change.id,
          now: "2026-07-17T22:58:00.000Z",
        });

        expect(completed).toMatchObject({
          ok: true,
          changed: true,
          change: { state: "closed", closeReason: "completed", cleanup: { state: "pending" } },
        });
        expect(yield* tasks.getTaskById(taskId)).toMatchObject({ state: "done" });
      }),
    ),
  );

  it.scoped("rolls back the complete Candidate capture when its write fails", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const repository = yield* RepositorySql;
        const capture = yield* openSqliteChangeCandidateCapturePersistence();
        yield* repository.operation(
          "prepare failed Candidate capture",
          (sql) => sql`
            INSERT INTO changes (
              id, repository_common_directory, branch_ref, base_ref, task_id, state,
              close_reason, created_at, updated_at, closed_at
            ) VALUES (
              'change-1', ${input.commonDirectory}, 'refs/heads/feature', NULL, NULL,
              'open', NULL, '2026-07-17T23:00:00.000Z', '2026-07-17T23:00:00.000Z', NULL
            )
          `,
        );
        yield* repository.operation(
          "install Candidate capture failure",
          (sql) => sql`
            CREATE TRIGGER reject_candidate_capture
            BEFORE INSERT ON candidates
            BEGIN
              SELECT RAISE(ABORT, 'deliberate Candidate write failure');
            END
          `,
        );

        yield* capture
          .commitCapture({
            repositoryCommonDirectory: input.commonDirectory,
            branchRef: "refs/heads/feature",
            expectedChangeId: "change-1",
            selectedBaseRef: "refs/heads/main",
            resolvedTargetSha: "base",
            comparisonBaseSha: "base",
            headSha: "head",
            now: "2026-07-17T23:01:00.000Z",
          })
          .pipe(Effect.flip);

        expect(yield* capture.getChangeById("change-1")).toMatchObject({ baseRef: null });
        const candidates = yield* repository.operation(
          "read failed Candidate capture",
          (sql) => sql<{ readonly count: number }>`SELECT COUNT(*) AS count FROM candidates`,
        );
        expect(candidates).toEqual([{ count: 0 }]);
      }),
    ),
  );

  it.scoped("acquires migrated repository state through one scoped SQL service", () =>
    withTemporaryState(() =>
      Effect.gen(function* () {
        const repositorySql = yield* RepositorySql;
        const migrations = yield* repositorySql.operation(
          "read repository migrations",
          (sql) => sql<{
            readonly migration_id: number;
            readonly name: string;
          }>`
            SELECT migration_id, name
            FROM effect_sql_migrations
            ORDER BY migration_id
          `,
        );
        const identities = yield* repositorySql.operation(
          "read repository identity",
          (sql) => sql<{
            readonly common_directory: string;
          }>`
            SELECT common_directory
            FROM shared_state_identity
            WHERE id = 1
          `,
        );

        expect(migrations).toEqual([{ migration_id: 1, name: "baseline" }]);
        expect(identities).toEqual([{ common_directory: repositorySql.commonDirectory }]);
      }),
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
              const repository = yield* RepositorySql;
              yield* repository.operation(
                "drop migrated Task comments",
                (sql) => sql`DROP TABLE task_comments`,
              );
              yield* repository.operation(
                "replace Task comments with an incompatible view",
                (sql) => sql`CREATE VIEW task_comments AS SELECT 1 AS sequence`,
              );
              yield* repository.operation(
                "clear repository migration ledger",
                (sql) => sql`DELETE FROM effect_sql_migrations`,
              );
            }).pipe(Effect.provide(repositorySqlLayer({ commonDirectory: directory, statePath }))),
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

  it.effect("reports unavailable repository state through the typed error channel", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.scoped(
          RepositorySql.pipe(
            Effect.provide(
              repositorySqlLayer({
                commonDirectory: directory,
                statePath: directory,
              }),
            ),
          ),
        ).pipe(
          Effect.flip,
          Effect.map((error) => {
            expect(error).toBeInstanceOf(RepositoryStateUnavailable);
            expect(error).toMatchObject({
              _tag: "RepositoryStateUnavailable",
              statePath: directory,
            });
            return error;
          }),
        ),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.scoped("keeps domain rejections successful and rolls back failed operations", () =>
    withTemporaryState(() =>
      Effect.gen(function* () {
        const repositorySql = yield* RepositorySql;
        yield* repositorySql.operation(
          "create transaction probe",
          (sql) => sql`
            CREATE TABLE transaction_probe (value TEXT NOT NULL)
          `,
        );

        const rejection = { ok: false as const, code: "identity_conflict" as const };
        const rejectionResult = yield* repositorySql.transaction("preserve domain rejection", () =>
          Effect.succeed(rejection),
        );

        expect(rejectionResult).toEqual(rejection);

        yield* repositorySql
          .transaction("roll back failed write", (sql) =>
            Effect.gen(function* () {
              yield* sql`
                INSERT INTO transaction_probe (value) VALUES (${"rolled back"})
              `;
              return yield* new RepositoryPersistedDataInvalid({
                operationName: "decode transaction probe",
                cause: new Error("deliberate persisted-data failure"),
              });
            }),
          )
          .pipe(Effect.flip);

        const rows = yield* repositorySql.operation(
          "read transaction probe",
          (sql) => sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count FROM transaction_probe
          `,
        );
        expect(rows).toEqual([{ count: 0 }]);
      }),
    ),
  );

  it.scoped("reports malformed persisted string arrays through the typed error channel", () =>
    withTemporaryState(() =>
      Effect.gen(function* () {
        const repositorySql = yield* RepositorySql;
        const error = yield* repositorySql
          .decodeStringArray("read Finding files", '["file.ts",]')
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(RepositoryPersistedDataInvalid);
        expect(error).toMatchObject({
          _tag: "RepositoryPersistedDataInvalid",
          operationName: "read Finding files",
        });
      }),
    ),
  );

  it.scoped("reports SQL operation failures through the typed error channel", () =>
    withTemporaryState(() =>
      Effect.gen(function* () {
        const repositorySql = yield* RepositorySql;
        const error = yield* repositorySql
          .operation("read missing storage", (sql) => sql`SELECT * FROM missing_table`)
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(RepositorySqlOperationFailed);
        expect(error).toMatchObject({
          _tag: "RepositorySqlOperationFailed",
          operationName: "read missing storage",
        });
      }),
    ),
  );

  it.effect("reports a repository identity conflict through the typed error channel", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) => {
        const statePath = join(directory, "state.sqlite");
        const acquire = (commonDirectory: string) =>
          Effect.scoped(
            RepositorySql.pipe(Effect.provide(repositorySqlLayer({ commonDirectory, statePath }))),
          );

        return Effect.gen(function* () {
          yield* acquire(join(directory, "first"));
          const error = yield* acquire(join(directory, "second")).pipe(Effect.flip);

          expect(error).toBeInstanceOf(RepositoryIdentityConflict);
          expect(error).toMatchObject({
            _tag: "RepositoryIdentityConflict",
            expectedCommonDirectory: join(directory, "second"),
            actualCommonDirectory: join(directory, "first"),
          });
        });
      },
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.scoped("enforces the current Change lifecycle schema", () =>
    withTemporaryState(() =>
      Effect.gen(function* () {
        const repository = yield* RepositorySql;
        const error = yield* repository
          .operation(
            "insert invalid Change lifecycle state",
            (sql) => sql`
            INSERT INTO changes (
              id, repository_common_directory, branch_ref, task_id, state,
              close_reason, created_at, updated_at, closed_at
            ) VALUES (
              'invalid-change', '/repo/.git', 'refs/heads/invalid', NULL, 'invalid',
              NULL, '2026-07-22T10:00:00.000Z', '2026-07-22T10:00:00.000Z', NULL
            )
          `,
          )
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(RepositorySqlOperationFailed);
        const rows = yield* repository.operation(
          "count invalid Change rows",
          (sql) => sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count FROM changes WHERE id = 'invalid-change'
          `,
        );
        expect(rows).toEqual([{ count: 0 }]);
      }),
    ),
  );

  it.effect("closes and reopens the same migrated repository state", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) => {
        const config = {
          commonDirectory: directory,
          statePath: join(directory, "state.sqlite"),
        };
        const readMigrationCount = Effect.scoped(
          migrationCount.pipe(Effect.provide(repositorySqlLayer(config))),
        );

        return Effect.gen(function* () {
          expect(yield* readMigrationCount).toBe(1);
          expect(yield* readMigrationCount).toBe(1);
        });
      },
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );
});
