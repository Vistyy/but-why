import { MigrationError } from "@effect/sql/Migrator";
import * as SqlClient from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import { Cause, Clock, Context, Effect, Layer } from "effect";
import {
  RepositoryIdentityConflict,
  RepositoryMigrationFailed,
  RepositoryPersistedDataInvalid,
  RepositoryRestoredTransientState,
  RepositorySqlOperationFailed,
  RepositoryStateUnavailable,
  type RepositoryStorageError,
  RestoredTransientStateError,
} from "../contracts/repositoryStorageError.js";
import { nodeSqliteLayer } from "./nodeSqliteClient.js";
import { migrateRepositoryState, repositoryMigrationIds } from "./repositoryMigrations.js";
import { decodeSqliteJsonStringArray } from "./sqliteJsonStringArray.js";

type RepositorySqlService = {
  readonly statePath: string;
  readonly commonDirectory: string;
  readonly operation: <A, R>(
    operationName: string,
    use: (sql: SqlClient.SqlClient) => Effect.Effect<A, SqlError, R>,
  ) => Effect.Effect<A, RepositorySqlOperationFailed, R>;
  readonly transaction: <A, E, R>(
    operationName: string,
    use: (sql: SqlClient.SqlClient) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<
    A,
    Exclude<E, { readonly _tag: "SqlError" }> | RepositorySqlOperationFailed,
    R
  >;
  readonly transactionImmediate: <A, E, R>(
    operationName: string,
    use: (sql: SqlClient.SqlClient) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<
    A,
    Exclude<E, { readonly _tag: "SqlError" }> | RepositorySqlOperationFailed,
    R
  >;
  readonly decodeStringArray: (
    operationName: string,
    value: string,
  ) => Effect.Effect<readonly string[], RepositoryPersistedDataInvalid>;
};

export class RepositorySql extends Context.Tag("@but-why/RepositorySql")<
  RepositorySql,
  RepositorySqlService
>() {}

export type RepositorySqlConfig = {
  readonly statePath: string;
  readonly commonDirectory: string;
  readonly sqliteBusyTimeoutMs?: number;
  readonly migrationContentionTimeoutMs?: number;
  readonly migrationContentionRetryDelayMs?: number;
};

const defaultSqliteBusyTimeoutMs = 5_000;
const defaultMigrationContentionTimeoutMs = 30_000;
const defaultMigrationContentionRetryDelayMs = 50;

const ensureRepositoryIdentity = (sql: SqlClient.SqlClient, commonDirectory: string) =>
  Effect.gen(function* () {
    const identities = yield* sql<{ readonly commonDirectory: string }>`
      SELECT common_directory AS commonDirectory
      FROM shared_state_identity
      WHERE id = 1
    `;
    const identity = identities[0];

    if (identity === undefined) {
      yield* sql`
        INSERT INTO shared_state_identity (id, common_directory)
        VALUES (1, ${commonDirectory})
        ON CONFLICT(id) DO NOTHING
      `;
      const confirmed = yield* sql<{ readonly commonDirectory: string }>`
        SELECT common_directory AS commonDirectory
        FROM shared_state_identity
        WHERE id = 1
      `;
      if (confirmed[0] === undefined) {
        return yield* new RepositorySqlOperationFailed({
          operationName: "validate repository identity",
          cause: new Error("Repository identity row is missing after creation"),
        });
      }
      if (confirmed[0].commonDirectory !== commonDirectory) {
        return yield* new RepositoryIdentityConflict({
          expectedCommonDirectory: commonDirectory,
          actualCommonDirectory: confirmed[0].commonDirectory,
        });
      }
      return;
    }

    if (identity.commonDirectory !== commonDirectory) {
      return yield* new RepositoryIdentityConflict({
        expectedCommonDirectory: commonDirectory,
        actualCommonDirectory: identity.commonDirectory,
      });
    }
  });

const isRepositoryMigrationLedgerComplete = (
  sql: SqlClient.SqlClient,
): Effect.Effect<boolean, SqlError> =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly migration_id: number }>`
      SELECT migration_id FROM effect_sql_migrations
    `;
    const present = new Set(rows.map((row) => row.migration_id));
    return repositoryMigrationIds.every((id) => present.has(id));
  });

// SQLITE_BUSY (5) and SQLITE_LOCKED (6) are the lock-contention results that mean another
// process holds the migration write lock. A missing ledger table (errcode 1 with a
// "no such table" message) means the Migrator has not created it yet, which is also
// contention. Every other SqlError is a real failure and must stop immediately.
const isMigrationContentionError = (error: SqlError): boolean => {
  const cause = error.cause as
    | { readonly errcode?: number; readonly errstr?: string; readonly message?: string }
    | undefined;
  if (cause?.errcode === 5 || cause?.errcode === 6) return true;
  if (cause?.errcode !== 1) return false;
  const sqliteMessage = cause.message ?? cause.errstr ?? "";
  return sqliteMessage.includes("no such table");
};

const readMigrationLedgerState = (
  sql: SqlClient.SqlClient,
  statePath: string,
): Effect.Effect<boolean, RepositoryStorageError> =>
  isRepositoryMigrationLedgerComplete(sql).pipe(
    Effect.catchTag("SqlError", (error) =>
      isMigrationContentionError(error)
        ? Effect.succeed(false)
        : Effect.fail(migrationFailureToStorageError(Cause.fail(error), statePath)),
    ),
  );

// Cross-process creation and migration coordination relies on SQLite file locking and the
// Effect SQL Migrator's claim transaction. The Migrator inserts every pending migration id
// into `effect_sql_migrations` inside one transaction before running the migration effects,
// so a contending process cannot see a partial ledger: it either observes the old committed
// ledger (migration still running) or the complete committed ledger (migration finished).
// An already-current ledger returns immediately without running the Migrator or acquiring
// migration locks, so ordinary opens do not acquire migration coordination. A busy SqlError
// from the Migrator means the connection could not acquire the SQLite write lock while
// another process migrated; treat it as contention and retry within the bound.
const migrateRepositoryStateWithContention = (
  sql: SqlClient.SqlClient,
  config: RepositorySqlConfig,
): Effect.Effect<void, RepositoryStorageError, SqlClient.SqlClient> => {
  const contentionTimeoutMs =
    config.migrationContentionTimeoutMs ?? defaultMigrationContentionTimeoutMs;
  const retryDelayMs =
    config.migrationContentionRetryDelayMs ?? defaultMigrationContentionRetryDelayMs;

  const attempt = Effect.gen(function* () {
    yield* migrateRepositoryState.pipe(
      Effect.catchTag("SqlError", (error) =>
        isMigrationContentionError(error)
          ? Effect.void
          : Effect.fail(migrationFailureToStorageError(Cause.fail(error), config.statePath)),
      ),
      Effect.catchTag("MigrationError", (error) =>
        Effect.fail(migrationFailureToStorageError(Cause.fail(error), config.statePath)),
      ),
      Effect.catchAllDefect((defect) =>
        Effect.fail(migrationFailureToStorageError(Cause.die(defect), config.statePath)),
      ),
    );
    return yield* readMigrationLedgerState(sql, config.statePath);
  });

  const migrateWithBound = (
    startedAt: number,
  ): Effect.Effect<void, RepositoryStorageError, SqlClient.SqlClient> =>
    Effect.gen(function* () {
      if ((yield* Clock.currentTimeMillis) - startedAt >= contentionTimeoutMs) {
        return yield* new RepositoryStateUnavailable({
          statePath: config.statePath,
          cause: new Error(
            `Shared Repository State migration remained busy for ${contentionTimeoutMs}ms`,
          ),
        });
      }
      const complete = yield* attempt;
      if (complete) return;
      yield* Effect.sleep(`${retryDelayMs} millis`);
      return yield* migrateWithBound(startedAt);
    });

  return readMigrationLedgerState(sql, config.statePath).pipe(
    Effect.flatMap((complete) =>
      complete ? Effect.void : Effect.flatMap(Clock.currentTimeMillis, migrateWithBound),
    ),
  );
};

const migrationFailureToStorageError = (
  cause: Cause.Cause<unknown>,
  statePath: string,
): RepositoryStorageError => {
  const restored = Array.from(Cause.defects(cause)).find(
    (defect): defect is MigrationError & { readonly cause: RestoredTransientStateError } =>
      defect instanceof MigrationError && defect.cause instanceof RestoredTransientStateError,
  );
  if (restored !== undefined) {
    return new RepositoryRestoredTransientState({
      tasks: restored.cause.tasks,
      changes: restored.cause.changes,
    });
  }
  return new RepositoryMigrationFailed({ statePath, cause });
};

export const repositorySqlLayer = (
  config: RepositorySqlConfig,
): Layer.Layer<RepositorySql, RepositoryStorageError> => {
  const sqlite = nodeSqliteLayer(config.statePath, {
    busyTimeoutMs: config.sqliteBusyTimeoutMs ?? defaultSqliteBusyTimeoutMs,
  }).pipe(
    Layer.catchAllCause((cause) =>
      Layer.fail(
        new RepositoryStateUnavailable({
          statePath: config.statePath,
          cause,
        }),
      ),
    ),
  );

  const repository = Layer.effect(
    RepositorySql,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql
        .unsafe("PRAGMA foreign_keys = OFF")
        .pipe(
          Effect.mapError(
            (cause) => new RepositoryStateUnavailable({ statePath: config.statePath, cause }),
          ),
        );
      yield* migrateRepositoryStateWithContention(sql, config);
      yield* sql
        .unsafe("PRAGMA foreign_keys = ON")
        .pipe(
          Effect.mapError(
            (cause) => new RepositoryStateUnavailable({ statePath: config.statePath, cause }),
          ),
        );
      yield* ensureRepositoryIdentity(sql, config.commonDirectory).pipe(
        Effect.mapError((cause) =>
          cause instanceof RepositoryIdentityConflict
            ? cause
            : new RepositorySqlOperationFailed({
                operationName: "validate repository identity",
                cause,
              }),
        ),
      );

      return {
        statePath: config.statePath,
        commonDirectory: config.commonDirectory,
        operation: (operationName, use) =>
          use(sql).pipe(
            Effect.mapError(
              (cause) =>
                new RepositorySqlOperationFailed({
                  operationName,
                  cause,
                }),
            ),
          ),
        transaction: (operationName, use) =>
          sql.withTransaction(use(sql)).pipe(
            Effect.catchTag("SqlError", (cause) =>
              Effect.fail(
                new RepositorySqlOperationFailed({
                  operationName,
                  cause,
                }),
              ),
            ),
          ),
        transactionImmediate: (operationName, use) =>
          sql
            .withTransaction(
              Effect.zipRight(
                sql`
                  UPDATE shared_state_identity
                  SET common_directory = common_directory
                  WHERE id = 1
                `,
                use(sql),
              ),
            )
            .pipe(
              Effect.catchTag("SqlError", (cause) =>
                Effect.fail(
                  new RepositorySqlOperationFailed({
                    operationName,
                    cause,
                  }),
                ),
              ),
            ),
        decodeStringArray: (operationName, value) =>
          Effect.try({
            try: () => decodeSqliteJsonStringArray(value),
            catch: (cause) =>
              new RepositoryPersistedDataInvalid({
                operationName,
                cause,
              }),
          }),
      };
    }),
  );

  return repository.pipe(Layer.provide(sqlite));
};
