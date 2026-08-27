import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { RepositoryStateUnavailable } from "../../src/contracts/repositoryStorageError.js";
import {
  RepositorySql,
  repositorySqlLayer,
} from "../../src/repositoryRuntime/adapters/sqlite/repositorySql.js";

const operationDeadlineMs = 1_500;
const outerTestDeadline = "2 seconds";

type TemporaryDirectory = {
  readonly directory: string;
};

const withTemporaryDirectory = <A, E, R>(
  prefix: string,
  use: (temporary: TemporaryDirectory) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | unknown, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => ({ directory: mkdtempSync(join(tmpdir(), prefix)) })),
    use,
    (temporary) => Effect.sync(() => rmSync(temporary.directory, { recursive: true, force: true })),
  );

const withHeldWriteLock = <A, E>(
  statePath: string,
  use: () => Effect.Effect<A, E>,
  createMigrationLedger = false,
): Effect.Effect<A, E | unknown> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const database = new DatabaseSync(statePath, { timeout: 0 });
      if (createMigrationLedger) {
        database.exec(`
            CREATE TABLE IF NOT EXISTS effect_sql_migrations (
              migration_id INTEGER PRIMARY KEY NOT NULL,
              created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              name VARCHAR(255) NOT NULL
            )
          `);
      }
      database.exec("BEGIN IMMEDIATE");
      return database;
    }),
    use,
    (database) =>
      Effect.sync(() => {
        try {
          database.exec("ROLLBACK");
        } finally {
          database.close();
        }
      }),
  );

describe("Shared Repository State initialization coordination", () => {
  it.live("initializes one absent path concurrently through independent connections", () =>
    withTemporaryDirectory("but-why-concurrent-init-", (temporary) => {
      const statePath = join(temporary.directory, "state.sqlite");
      const initialize = () =>
        Effect.scoped(
          Effect.gen(function* () {
            const repository = yield* RepositorySql;
            return yield* repository.operation(
              "read initialized repository identity",
              (sql) => sql<{ readonly commonDirectory: string; readonly idPrefix: string }>`
                SELECT common_directory AS commonDirectory, id_prefix AS idPrefix
                FROM shared_state_identity
                WHERE id = 1
              `,
            );
          }).pipe(
            Effect.provide(
              repositorySqlLayer({
                statePath,
                commonDirectory: temporary.directory,
                lifecycle: "initialize",
                sqliteBusyTimeoutMs: 250,
                migrationContentionTimeoutMs: 1_000,
                migrationContentionRetryDelayMs: 20,
              }),
            ),
          ),
        );

      return Effect.all([initialize(), initialize()], { concurrency: 2 }).pipe(
        Effect.map((identities) => {
          expect(identities).toEqual([
            [{ commonDirectory: temporary.directory, idPrefix: "BY" }],
            [{ commonDirectory: temporary.directory, idPrefix: "BY" }],
          ]);
          return identities;
        }),
      );
    }).pipe(Effect.timeout(outerTestDeadline)),
  );

  it.live(
    "returns bounded unavailability under migration contention and recovers after release",
    () =>
      withTemporaryDirectory("but-why-migration-contention-", (temporary) => {
        const statePath = join(temporary.directory, "state.sqlite");
        return withHeldWriteLock(
          statePath,
          () => {
            const startedAt = performance.now();
            return Effect.either(
              Effect.scoped(
                RepositorySql.pipe(
                  Effect.provide(
                    repositorySqlLayer({
                      statePath,
                      commonDirectory: temporary.directory,
                      lifecycle: "initialize",
                      sqliteBusyTimeoutMs: 50,
                      migrationContentionTimeoutMs: 250,
                      migrationContentionRetryDelayMs: 20,
                    }),
                  ),
                ),
              ).pipe(Effect.timeout(operationDeadlineMs)),
            ).pipe(
              Effect.flatMap((contended) => {
                expect(contended._tag).toBe("Left");
                if (contended._tag === "Left") {
                  expect(contended.left).toBeInstanceOf(RepositoryStateUnavailable);
                }
                expect(performance.now() - startedAt).toBeLessThan(operationDeadlineMs);
                return Effect.void;
              }),
            );
          },
          true,
        ).pipe(
          Effect.zipRight(
            Effect.scoped(
              Effect.gen(function* () {
                const repository = yield* RepositorySql;
                const identities = yield* repository.operation(
                  "verify recovered repository identity",
                  (sql) => sql<{ readonly commonDirectory: string; readonly idPrefix: string }>`
                    SELECT common_directory AS commonDirectory, id_prefix AS idPrefix
                    FROM shared_state_identity
                    WHERE id = 1
                  `,
                );
                expect(identities).toEqual([
                  { commonDirectory: temporary.directory, idPrefix: "BY" },
                ]);
              }).pipe(
                Effect.provide(
                  repositorySqlLayer({
                    statePath,
                    commonDirectory: temporary.directory,
                    lifecycle: "initialize",
                  }),
                ),
              ),
            ).pipe(Effect.timeout(operationDeadlineMs)),
          ),
        );
      }).pipe(Effect.timeout(outerTestDeadline)),
  );

  it.live("opens current state while another connection holds a migration write transaction", () =>
    withTemporaryDirectory("but-why-current-open-", (temporary) => {
      const statePath = join(temporary.directory, "state.sqlite");
      const initialize = Effect.scoped(
        Effect.gen(function* () {
          const repository = yield* RepositorySql;
          const identities = yield* repository.operation(
            "prime current repository identity",
            (sql) => sql<{ readonly commonDirectory: string; readonly idPrefix: string }>`
              SELECT common_directory AS commonDirectory, id_prefix AS idPrefix
              FROM shared_state_identity
              WHERE id = 1
            `,
          );
          expect(identities).toEqual([{ commonDirectory: temporary.directory, idPrefix: "BY" }]);
        }).pipe(
          Effect.provide(
            repositorySqlLayer({
              statePath,
              commonDirectory: temporary.directory,
              lifecycle: "initialize",
            }),
          ),
        ),
      ).pipe(Effect.timeout(operationDeadlineMs));
      return initialize.pipe(
        Effect.zipRight(
          withHeldWriteLock(statePath, () =>
            Effect.scoped(
              Effect.gen(function* () {
                const repository = yield* RepositorySql;
                const identities = yield* repository.operation(
                  "read current repository identity while locked",
                  (sql) => sql<{ readonly commonDirectory: string; readonly idPrefix: string }>`
                    SELECT common_directory AS commonDirectory, id_prefix AS idPrefix
                    FROM shared_state_identity
                    WHERE id = 1
                  `,
                );
                return identities;
              }).pipe(
                Effect.provide(
                  repositorySqlLayer({
                    statePath,
                    commonDirectory: temporary.directory,
                    sqliteBusyTimeoutMs: 50,
                  }),
                ),
              ),
            ).pipe(Effect.timeout(operationDeadlineMs)),
          ).pipe(
            Effect.map((identities) => {
              expect(identities).toEqual([
                { commonDirectory: temporary.directory, idPrefix: "BY" },
              ]);
              return identities;
            }),
          ),
        ),
      );
    }).pipe(Effect.timeout(outerTestDeadline)),
  );
});
