import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

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
type NodeSqliteStatement = ReturnType<DatabaseSync["prepare"]>;

type StatementReader<A> = (statement: NodeSqliteStatement, params: SqliteParameter[]) => A;

const nodeSqliteConnection = (database: DatabaseSync): NodeSqliteConnection => {
  const executeStatement = <A>(
    sql: string,
    params: ReadonlyArray<unknown>,
    read: StatementReader<A>,
  ): Effect.Effect<A, SqlError> =>
    Effect.withFiberRuntime((fiber) => {
      try {
        const statement = database.prepare(sql);
        statement.setReturnArrays(false);
        if (Context.get(fiber.currentContext, SqlClient.SafeIntegers)) {
          statement.setReadBigInts(true);
        }
        return Effect.succeed(read(statement, params as SqliteParameter[]));
      } catch (cause) {
        return Effect.fail(new SqlError({ cause, message: "Failed to execute statement" }));
      }
    });

  const executeRows = (sql: string, params: ReadonlyArray<unknown>) =>
    executeStatement(sql, params, (statement, boundParams) => {
      if (statement.columns().length > 0) {
        return statement.all(...boundParams);
      }
      statement.run(...boundParams);
      return [];
    });

  return {
    execute: (sql, params, transformRows) => {
      const effect = executeRows(sql, params);
      return transformRows
        ? effect.pipe(Effect.map((rows) => transformRows(rows as ReadonlyArray<object>)))
        : effect;
    },
    executeRaw: (sql, params) =>
      executeStatement(sql, params, (statement, boundParams) =>
        statement.columns().length > 0
          ? statement.all(...boundParams)
          : statement.run(...boundParams),
      ),
    executeValues: (sql, params) =>
      executeStatement(sql, params, (statement, boundParams) => {
        statement.setReturnArrays(true);
        if (statement.columns().length > 0) {
          return statement.all(...boundParams).map((row) => {
            if (!Array.isArray(row)) {
              throw new TypeError("SQLite return-array mode returned a non-array row");
            }
            return row;
          });
        }
        statement.run(...boundParams);
        return [];
      }),
    executeUnprepared: (sql, params, transformRows) => {
      const effect = executeRows(sql, params);
      return transformRows
        ? effect.pipe(Effect.map((rows) => transformRows(rows as ReadonlyArray<object>)))
        : effect;
    },
    executeStream: (sql, params, transformRows) =>
      Stream.fromEffect(
        executeRows(sql, params).pipe(
          Effect.map((rows) =>
            transformRows ? transformRows(rows as ReadonlyArray<object>) : rows,
          ),
        ),
      ).pipe(Stream.flatMap((rows) => Stream.fromIterable(rows))),
  };
};

export const nodeSqliteLayer = (
  filename: string,
  options: { readonly busyTimeoutMs?: number; readonly allowCreate?: boolean } = {},
): Layer.Layer<SqlClient.SqlClient> =>
  Layer.scopedContext(
    Effect.gen(function* () {
      const location =
        options.allowCreate === false && filename !== ":memory:"
          ? `${pathToFileURL(filename).href}?mode=rw`
          : filename;
      const database = new DatabaseSync(location, {
        timeout: options.busyTimeoutMs ?? busyTimeoutMs,
      });
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
