import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { ensureStateDatabase, stateDatabaseTimeoutMs } from "../init/stateDatabase.js";

export type SqliteStoreInput = {
  readonly statePath: string;
  readonly migrationTimestamp: () => string;
};

class SqliteStateUnavailableError extends Error {
  constructor() {
    super("Durable Task state is unavailable");
  }
}

export const withStateDatabase = <Result>(
  input: SqliteStoreInput,
  work: (database: DatabaseSync) => Result,
): Result => {
  if (!existsSync(input.statePath)) {
    throw new SqliteStateUnavailableError();
  }

  ensureStateDatabase(input.statePath, input.migrationTimestamp);
  const database = new DatabaseSync(input.statePath, { timeout: stateDatabaseTimeoutMs });

  try {
    return work(database);
  } finally {
    database.close();
  }
};

export const rollbackIfOpen = (database: DatabaseSync): void => {
  try {
    database.exec("ROLLBACK");
  } catch {
    // The transaction may already be rolled back for expected domain failures.
  }
};
