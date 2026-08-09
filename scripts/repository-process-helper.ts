import { existsSync, watch } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { Effect } from "effect";

import { RepositorySql, repositorySqlLayer } from "../src/sqlite/repositorySql.js";
import { openSqliteTaskPersistence } from "../src/sqlite/sqliteTaskPersistence.js";
import { storedPublicTaskId } from "../src/task/taskId.js";

const usage = `Usage: repositoryProcessHelper.ts <hold-lock|open-state|open-read> ...

Commands:
  hold-lock <statePath> <releasePath>
    Open <statePath>, create the migration ledger table, hold the SQLite migration
    write lock until <releasePath> exists, then roll back.
  open-state <statePath> <commonDirectory> [busyTimeoutMs] [contentionTimeoutMs]
             [retryDelayMs] <title>
    Open Shared Repository State through the repository SQL layer and create and
    read back one Task. Prints one JSON line and exits 0 on success or 1 on
    failure with the typed storage error tag.
  open-read <statePath> <commonDirectory> [busyTimeoutMs] [contentionTimeoutMs]
            [retryDelayMs]
    Open Shared Repository State through the repository SQL layer and read the
    migration ledger count without writing. Prints one JSON line and exits 0 on
    success or 1 on failure with the typed storage error tag.
`;

type OpenStateInput = {
  readonly statePath: string;
  readonly commonDirectory: string;
  readonly busyTimeoutMs?: number;
  readonly contentionTimeoutMs?: number;
  readonly retryDelayMs?: number;
  readonly title: string;
};

const openState = async (input: OpenStateInput): Promise<number> => {
  process.stderr.write("opening\n");
  const program = Effect.gen(function* () {
    const tasks = yield* openSqliteTaskPersistence("BY");
    const created = yield* tasks.createTask({
      title: input.title,
      description: "Concurrent Shared Repository State initialization evidence.",
      now: "2026-07-17T22:45:00.000Z",
    });
    if (!created.ok) return { ok: false as const, code: created.code };
    const stored = yield* tasks.getTaskById(storedPublicTaskId(created.task.id));
    return {
      ok: true as const,
      taskId: storedPublicTaskId(created.task.id),
      found: stored !== undefined,
    };
  });

  const outcome = await Effect.runPromise(
    Effect.either(
      Effect.scoped(
        program.pipe(
          Effect.provide(
            repositorySqlLayer({
              statePath: input.statePath,
              commonDirectory: input.commonDirectory,
              ...(input.busyTimeoutMs === undefined
                ? {}
                : { sqliteBusyTimeoutMs: input.busyTimeoutMs }),
              ...(input.contentionTimeoutMs === undefined
                ? {}
                : { migrationContentionTimeoutMs: input.contentionTimeoutMs }),
              ...(input.retryDelayMs === undefined
                ? {}
                : { migrationContentionRetryDelayMs: input.retryDelayMs }),
            }),
          ),
        ),
      ),
    ),
  );

  if (outcome._tag === "Left") {
    process.stdout.write(JSON.stringify({ ok: false, error: { _tag: outcome.left._tag } }) + "\n");
    return 1;
  }
  process.stdout.write(JSON.stringify(outcome.right) + "\n");
  return 0;
};

const openRead = async (input: {
  readonly statePath: string;
  readonly commonDirectory: string;
  readonly busyTimeoutMs?: number;
  readonly contentionTimeoutMs?: number;
  readonly retryDelayMs?: number;
}): Promise<number> => {
  const program = Effect.gen(function* () {
    const repositorySql = yield* RepositorySql;
    const rows = yield* repositorySql.operation(
      "read repository migration ledger",
      (sql) => sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM effect_sql_migrations
      `,
    );
    return { ok: true as const, migrationCount: rows[0]?.count ?? -1 };
  });

  const outcome = await Effect.runPromise(
    Effect.either(
      Effect.scoped(
        program.pipe(
          Effect.provide(
            repositorySqlLayer({
              statePath: input.statePath,
              commonDirectory: input.commonDirectory,
              ...(input.busyTimeoutMs === undefined
                ? {}
                : { sqliteBusyTimeoutMs: input.busyTimeoutMs }),
              ...(input.contentionTimeoutMs === undefined
                ? {}
                : { migrationContentionTimeoutMs: input.contentionTimeoutMs }),
              ...(input.retryDelayMs === undefined
                ? {}
                : { migrationContentionRetryDelayMs: input.retryDelayMs }),
            }),
          ),
        ),
      ),
    ),
  );

  if (outcome._tag === "Left") {
    process.stdout.write(JSON.stringify({ ok: false, error: { _tag: outcome.left._tag } }) + "\n");
    return 1;
  }
  process.stdout.write(JSON.stringify(outcome.right) + "\n");
  return 0;
};

const waitForRelease = (releasePath: string): Promise<void> =>
  new Promise((resolve) => {
    if (existsSync(releasePath)) {
      resolve();
      return;
    }
    const watcher = watch(dirname(releasePath), (_event, filename) => {
      if (filename === undefined || !existsSync(releasePath)) return;
      watcher.close();
      resolve();
    });
  });

const holdLock = async (statePath: string, releasePath: string): Promise<number> => {
  const database = new DatabaseSync(statePath, { timeout: 2_000 });
  database.exec(`
    CREATE TABLE IF NOT EXISTS effect_sql_migrations (
      migration_id integer PRIMARY KEY NOT NULL,
      created_at datetime NOT NULL DEFAULT current_timestamp,
      name VARCHAR(255) NOT NULL
    )
  `);
  // BEGIN IMMEDIATE acquires the SQLite write lock that the Migrator holds while it
  // claims and runs pending migrations.
  database.exec("BEGIN IMMEDIATE");
  process.stdout.write("locked\n");
  await waitForRelease(releasePath);
  // Roll back to release the write lock without leaving a committed claim row:
  // a real crash or rollback leaves the ledger without the uncommitted claim.
  database.exec("ROLLBACK");
  database.close();
  process.stdout.write("released\n");
  return 0;
};

const main = async (): Promise<number> => {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "hold-lock": {
      const [statePath, releasePath] = rest;
      if (statePath === undefined || releasePath === undefined) {
        process.stderr.write(usage + "\n");
        return 2;
      }
      return await holdLock(statePath, releasePath);
    }
    case "open-state": {
      const [statePath, commonDirectory, busyTimeoutMs, contentionTimeoutMs, retryDelayMs, title] =
        rest;
      if (statePath === undefined || commonDirectory === undefined || title === undefined) {
        process.stderr.write(usage + "\n");
        return 2;
      }
      return await openState({
        statePath,
        commonDirectory,
        ...(busyTimeoutMs === undefined ? {} : { busyTimeoutMs: Number(busyTimeoutMs) }),
        ...(contentionTimeoutMs === undefined
          ? {}
          : { contentionTimeoutMs: Number(contentionTimeoutMs) }),
        ...(retryDelayMs === undefined ? {} : { retryDelayMs: Number(retryDelayMs) }),
        title,
      });
    }
    case "open-read": {
      const [statePath, commonDirectory, busyTimeoutMs, contentionTimeoutMs, retryDelayMs] = rest;
      if (statePath === undefined || commonDirectory === undefined) {
        process.stderr.write(usage + "\n");
        return 2;
      }
      return await openRead({
        statePath,
        commonDirectory,
        ...(busyTimeoutMs === undefined ? {} : { busyTimeoutMs: Number(busyTimeoutMs) }),
        ...(contentionTimeoutMs === undefined
          ? {}
          : { contentionTimeoutMs: Number(contentionTimeoutMs) }),
        ...(retryDelayMs === undefined ? {} : { retryDelayMs: Number(retryDelayMs) }),
      });
    }
    default:
      process.stderr.write(usage + "\n");
      return 2;
  }
};

process.exitCode = await main();
