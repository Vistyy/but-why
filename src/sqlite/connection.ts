import type * as SqlConnection from "@effect/sql/SqlConnection";
import type { SqlClient } from "@effect/sql/SqlClient";
import type { Effect as EffectType } from "effect/Effect";

import {
  SharedStateIdentityConflictError,
  StateDatabaseSqlError,
  validateStateDatabase as validateStateDatabaseInput,
  type StateDatabase,
} from "../init/stateDatabase.js";

export type SqliteStoreInput = StateDatabase;

export type SqliteDatabase = {
  readonly exec: (sql: string) => void;
  readonly prepare: (sql: string) => {
    readonly get: (...params: readonly unknown[]) => unknown;
    readonly all: (...params: readonly unknown[]) => readonly unknown[];
    readonly run: (...params: readonly unknown[]) => unknown;
  };
};

const connectionFor = (
  input: SqliteStoreInput,
  connection: SqlConnection.Connection,
): SqliteDatabase => {
  const run = <A>(effect: EffectType<A, unknown, never>): A => {
    try {
      return input.runSync(effect as EffectType<A, unknown, SqlClient>);
    } catch (error) {
      if (error instanceof SharedStateIdentityConflictError) throw error;
      if (error instanceof StateDatabaseSqlError) throw error;
      const cause = (error as { readonly cause?: unknown }).cause;
      throw new StateDatabaseSqlError(cause ?? error);
    }
  };

  return {
    exec: (sql) => {
      run(connection.execute(sql, [], undefined));
    },
    prepare: (sql) => ({
      get: (...params) => {
        const rows = run(connection.execute(sql, params, undefined)) as readonly unknown[];
        return rows[0];
      },
      all: (...params) => run(connection.execute(sql, params, undefined)) as readonly unknown[],
      run: (...params) => run(connection.execute(sql, params, undefined)),
    }),
  };
};

export const validateSqliteStateDatabase = validateStateDatabaseInput;

export const withStateDatabase = <Result>(
  input: SqliteStoreInput,
  work: (database: SqliteDatabase) => Result,
): Result => input.withConnection((connection) => work(connectionFor(input, connection)));

export const rollbackIfOpen = (database: SqliteDatabase): void => {
  try {
    database.exec("ROLLBACK");
  } catch {
    // The transaction may already be rolled back for expected domain failures.
  }
};
