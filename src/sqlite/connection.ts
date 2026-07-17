import type { DatabaseSync } from "node:sqlite";

import { validateStateDatabase, type StateDatabaseSession } from "../init/stateDatabase.js";

export { validateStateDatabase };

export type SqliteStoreInput = StateDatabaseSession;

export const withStateDatabase = <Result>(
  input: StateDatabaseSession,
  work: (database: DatabaseSync) => Result,
): Result => input.withDatabase(work);

export const rollbackIfOpen = (database: DatabaseSync): void => {
  try {
    database.exec("ROLLBACK");
  } catch {
    // The transaction may already be rolled back for expected domain failures.
  }
};
