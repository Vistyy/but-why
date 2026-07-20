import type { SqliteDatabase } from "./connection.js";

export type SqliteValue = string | number | bigint | Uint8Array | null;

export const queryOne = <Row>(
  database: SqliteDatabase,
  sql: string,
  params: readonly SqliteValue[] = [],
): Row | undefined => database.prepare(sql).get(...params) as Row | undefined;

export const queryAll = <Row>(
  database: SqliteDatabase,
  sql: string,
  params: readonly SqliteValue[] = [],
): readonly Row[] => database.prepare(sql).all(...params) as readonly Row[];
