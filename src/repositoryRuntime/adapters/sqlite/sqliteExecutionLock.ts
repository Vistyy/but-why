import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";

import {
  type ExecutionLock,
  ExecutionLockUnavailable as ExecutionLockUnavailableError,
} from "../../../contracts/executionLock.js";

export type SqliteExecutionLockConfig = {
  readonly commonDirectory: string;
};

const lockPathFor = (config: SqliteExecutionLockConfig, owner: string, key: string): string =>
  join(
    config.commonDirectory,
    "but-why",
    "execution-locks",
    encodeURIComponent(owner),
    `${encodeURIComponent(key)}.sqlite`,
  );

export const openSqliteExecutionLock = (config: SqliteExecutionLockConfig): ExecutionLock => ({
  withLock: ({ owner, key, effect }) => {
    const lockPath = lockPathFor(config, owner, key);
    const ownerDirectory = join(
      config.commonDirectory,
      "but-why",
      "execution-locks",
      encodeURIComponent(owner),
    );

    const acquire = Effect.try({
      try: () => {
        mkdirSync(ownerDirectory, { recursive: true });
        const database = new DatabaseSync(lockPath);
        database.exec("PRAGMA busy_timeout = 0");
        database.exec(
          "CREATE TABLE IF NOT EXISTS execution_lock (id INTEGER PRIMARY KEY CHECK (id = 1), owner TEXT NOT NULL, key TEXT NOT NULL)",
        );
        database.exec("BEGIN IMMEDIATE");
        database
          .prepare("INSERT OR REPLACE INTO execution_lock (id, owner, key) VALUES (1, ?, ?)")
          .run(owner, key);
        return database;
      },
      catch: (cause) => new ExecutionLockUnavailableError({ owner, key, lockPath, cause }),
    });

    return Effect.scoped(
      Effect.gen(function* () {
        const database = yield* Effect.acquireRelease(acquire, (connection) =>
          Effect.sync(() => {
            if (connection.isOpen) connection.close();
          }).pipe(Effect.ignore),
        );
        return yield* Effect.onExit(effect, (exit) =>
          Effect.sync(() => {
            try {
              database.exec(exit._tag === "Success" ? "COMMIT" : "ROLLBACK");
            } finally {
              if (database.isOpen) database.close();
            }
          }).pipe(Effect.ignore),
        );
      }),
    );
  },
});
