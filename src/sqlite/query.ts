import type { DatabaseSync } from "node:sqlite";

export type SqliteValue = string | number | bigint | Uint8Array | null;

export const queryOne = <Row>(
  database: DatabaseSync,
  sql: string,
  params: readonly SqliteValue[] = [],
): Row | undefined => database.prepare(sql).get(...params) as Row | undefined;

export const queryAll = <Row>(
  database: DatabaseSync,
  sql: string,
  params: readonly SqliteValue[] = [],
): readonly Row[] => database.prepare(sql).all(...params) as unknown as readonly Row[];
