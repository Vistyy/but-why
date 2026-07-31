import { DatabaseSync } from "node:sqlite";
import { Data, Effect } from "effect";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export class ExecutionLockUnavailable extends Data.TaggedError("ExecutionLockUnavailable")<{
  readonly owner: string;
  readonly key: string;
  readonly lockPath: string;
  readonly cause: unknown;
}> {}

export type SqliteExecutionLock = {
  readonly withLock: <A, E, R>(input: {
    readonly owner: string;
    readonly key: string;
    readonly effect: Effect.Effect<A, E, R>;
  }) => Effect.Effect<A, E | ExecutionLockUnavailable, R>;
};

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

export const openSqliteExecutionLock = (
  config: SqliteExecutionLockConfig,
): SqliteExecutionLock => ({
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
      catch: (cause) => new ExecutionLockUnavailable({ owner, key, lockPath, cause }),
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
