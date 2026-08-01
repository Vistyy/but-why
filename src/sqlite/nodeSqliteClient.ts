import { DatabaseSync } from "node:sqlite";

import * as Reactivity from "@effect/experimental/Reactivity";
import * as SqlClient from "@effect/sql/SqlClient";
import type { Connection } from "@effect/sql/SqlConnection";
import { SqlError } from "@effect/sql/SqlError";
import * as Statement from "@effect/sql/Statement";
import { Context, Effect, Layer, Scope, Stream } from "effect";

const busyTimeoutMs = 5_000;
const databaseSystemName = "db.system.name";
type SqliteParameter = null | number | bigint | string | NodeJS.ArrayBufferView;

type NodeSqliteConnection = Connection;

const nodeSqliteConnection = (database: DatabaseSync): NodeSqliteConnection => {
  const executeStatement = (
    sql: string,
    params: ReadonlyArray<unknown>,
    raw: boolean,
  ): Effect.Effect<ReadonlyArray<unknown>, SqlError> =>
    Effect.withFiberRuntime((fiber) => {
      try {
        const statement = database.prepare(sql);
        statement.setReturnArrays(false);
        if (Context.get(fiber.currentContext, SqlClient.SafeIntegers)) {
          statement.setReadBigInts(true);
        }
        if (statement.columns().length > 0) {
          return Effect.succeed(statement.all(...(params as SqliteParameter[])));
        }
        const result = statement.run(...(params as SqliteParameter[]));
        return Effect.succeed(raw ? (result as unknown as ReadonlyArray<unknown>) : []);
      } catch (cause) {
        return Effect.fail(new SqlError({ cause, message: "Failed to execute statement" }));
      }
    });

  return {
    execute: (sql, params, transformRows) => {
      const effect = executeStatement(sql, params, false);
      return transformRows
        ? effect.pipe(Effect.map((rows) => transformRows(rows as ReadonlyArray<object>)))
        : effect;
    },
    executeRaw: (sql, params) => executeStatement(sql, params, true),
    executeValues: (sql, params) =>
      Effect.withFiberRuntime((fiber) => {
        try {
          const statement = database.prepare(sql);
          statement.setReturnArrays(true);
          if (Context.get(fiber.currentContext, SqlClient.SafeIntegers)) {
            statement.setReadBigInts(true);
          }
          if (statement.columns().length > 0) {
            return Effect.succeed(
              statement.all(...(params as SqliteParameter[])) as unknown as ReadonlyArray<
                ReadonlyArray<unknown>
              >,
            );
          }
          statement.run(...(params as SqliteParameter[]));
          return Effect.succeed([]);
        } catch (cause) {
          return Effect.fail(new SqlError({ cause, message: "Failed to execute statement" }));
        }
      }),
    executeUnprepared: (sql, params, transformRows) => {
      const effect = executeStatement(sql, params, false);
      return transformRows
        ? effect.pipe(Effect.map((rows) => transformRows(rows as ReadonlyArray<object>)))
        : effect;
    },
    executeStream: (sql, params, transformRows) =>
      Stream.fromEffect(
        executeStatement(sql, params, false).pipe(
          Effect.map((rows) =>
            transformRows ? transformRows(rows as ReadonlyArray<object>) : rows,
          ),
        ),
      ),
  };
};

export const nodeSqliteLayer = (filename: string): Layer.Layer<SqlClient.SqlClient> =>
  Layer.scopedContext(
    Effect.gen(function* () {
      const database = new DatabaseSync(filename, { timeout: busyTimeoutMs });
      const scope = yield* Effect.scope;
      yield* Scope.addFinalizer(
        scope,
        Effect.sync(() => database.close()),
      );

      const connection = nodeSqliteConnection(database);
      const semaphore = yield* Effect.makeSemaphore(1);
      const acquirer = semaphore.withPermits(1)(Effect.succeed(connection));
      const transactionAcquirer = Effect.uninterruptibleMask((restore) =>
        Effect.as(
          Effect.zipRight(
            restore(semaphore.take(1)),
            Effect.tap(Effect.scope, (transactionScope) =>
              Scope.addFinalizer(transactionScope, semaphore.release(1)),
            ),
          ),
          connection,
        ),
      );
      const client = yield* SqlClient.make({
        acquirer,
        transactionAcquirer,
        compiler: Statement.makeCompilerSqlite(),
        spanAttributes: [[databaseSystemName, "sqlite"]],
      });

      return Context.make(SqlClient.SqlClient, client);
    }),
  ).pipe(Layer.provide(Reactivity.layer));
