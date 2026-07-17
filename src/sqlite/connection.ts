import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
  ensureStateDatabase,
  SharedStateIdentityConflictError,
  stateDatabaseTimeoutMs,
} from "../init/stateDatabase.js";

export type SqliteStoreInput = {
  readonly statePath: string;
  readonly migrationTimestamp: () => string;
  readonly commonDirectory?: string;
};

class SqliteStateUnavailableError extends Error {
  constructor() {
    super("Durable Task state is unavailable");
  }
}

export const validateStateDatabase = (
  input: SqliteStoreInput,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "shared_state_identity_conflict" } => {
  try {
    ensureStateDatabase(input.statePath, input.migrationTimestamp, input.commonDirectory);
    return { ok: true };
  } catch (error) {
    if (error instanceof SharedStateIdentityConflictError) {
      return { ok: false, code: "shared_state_identity_conflict" };
    }
    throw error;
  }
};

export const withStateDatabase = <Result>(
  input: SqliteStoreInput,
  work: (database: DatabaseSync) => Result,
): Result => {
  if (!existsSync(input.statePath)) {
    throw new SqliteStateUnavailableError();
  }

  ensureStateDatabase(input.statePath, input.migrationTimestamp, input.commonDirectory);
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
