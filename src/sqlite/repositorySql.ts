import * as SqlClient from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { Context, Effect, Layer } from "effect";

import { migrateRepositoryState } from "./repositoryMigrations.js";
import {
  RepositoryIdentityConflict,
  RepositoryMigrationFailed,
  RepositoryPersistedDataInvalid,
  RepositorySqlOperationFailed,
  RepositoryStateUnavailable,
  type RepositoryStorageError,
} from "../contracts/repositoryStorageError.js";
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
};

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
      `;
      return;
    }

    if (identity.commonDirectory !== commonDirectory) {
      return yield* new RepositoryIdentityConflict({
        expectedCommonDirectory: commonDirectory,
        actualCommonDirectory: identity.commonDirectory,
      });
    }
  });

export const repositorySqlLayer = (
  config: RepositorySqlConfig,
): Layer.Layer<RepositorySql, RepositoryStorageError> => {
  const sqlite = SqliteClient.layer({
    filename: config.statePath,
    disableWAL: true,
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

      yield* migrateRepositoryState.pipe(
        Effect.catchAllCause((cause) =>
          Effect.fail(
            new RepositoryMigrationFailed({
              statePath: config.statePath,
              cause,
            }),
          ),
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
