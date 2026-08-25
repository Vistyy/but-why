import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { RepositoryStateUnavailable } from "../../src/contracts/repositoryStorageError.js";
import {
  RepositorySql,
  repositorySqlLayer,
} from "../../src/repositoryRuntime/adapters/sqlite/repositorySql.js";
import { repoRoot } from "../support/by-cli.js";
import { startTestProcess } from "../support/testProcess.js";

const helperTsxLoader = join(repoRoot, "node_modules/tsx/dist/loader.mjs");
const helperScript = join(repoRoot, "scripts/repository-process-helper.ts");
const operationDeadlineMs = 1_500;
const initializerOperationDeadlineMs = 2_000;
const readinessDeadlineMs = 2_500;
const childSettlementDeadlineMs = 100;
const cleanupDeadlineMs = 250;
const observationDeadlineMs = 250;
const outerTestDeadline = "5 seconds";

type ChildResult = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

type Initializer = {
  readonly child: ReturnType<typeof startTestProcess>;
  readonly ready: Promise<void>;
  readonly done: Promise<ChildResult>;
};

class DeadlineExceeded extends Error {
  constructor(description: string, timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms waiting for ${description}.`);
    this.name = "DeadlineExceeded";
  }
}

const bounded = async <A>(
  operation: Promise<A>,
  description: string,
  timeoutMs: number,
): Promise<A> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DeadlineExceeded(description, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

const startInitializer = (statePath: string, commonDirectory: string): Initializer => {
  const child = startTestProcess(
    process.execPath,
    ["--import", helperTsxLoader, helperScript, "initialize", statePath, commonDirectory],
    { cwd: dirname(statePath), timeout: 4_000 },
  );
  let stdout = "";
  let stderr = "";
  let readySeen = false;
  const ready = new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (!readySeen && stdout.includes("ready\n")) {
        readySeen = true;
        resolve();
      }
    });
    child.once("error", reject);
    child.once("close", () => {
      if (!readySeen) reject(new Error(`Initializer exited before readiness: ${stderr}`));
    });
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const done = new Promise<ChildResult>((resolve, reject) => {
    child.once("close", (status) => resolve({ status, stdout, stderr }));
    child.once("error", reject);
  });
  return { child, ready, done };
};

const stopInitializer = async (initializer: Initializer): Promise<void> => {
  if (initializer.child.exitCode === null) {
    initializer.child.kill("SIGUSR2");
    initializer.child.kill("SIGTERM");
  }
  try {
    await bounded(initializer.done, "initializer settlement", childSettlementDeadlineMs);
  } catch {
    if (initializer.child.exitCode === null) initializer.child.kill("SIGKILL");
    await bounded(
      initializer.done,
      "initializer settlement after SIGKILL",
      childSettlementDeadlineMs,
    );
  }
};

const runConcurrentInitializers = (
  statePath: string,
  commonDirectory: string,
  preserveTemporaryState: () => void,
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => [
      startInitializer(statePath, commonDirectory),
      startInitializer(statePath, commonDirectory),
    ]),
    (initializers) =>
      Effect.promise(async () => {
        await bounded(
          Promise.all(initializers.map((initializer) => initializer.ready)),
          "initializer readiness",
          readinessDeadlineMs,
        );
        for (const initializer of initializers) {
          if (initializer.child.exitCode === null) initializer.child.kill("SIGUSR2");
        }
        return await bounded(
          Promise.all(initializers.map((initializer) => initializer.done)),
          "initializer settlement",
          initializerOperationDeadlineMs,
        );
      }),
    (initializers) =>
      Effect.promise(async () => {
        try {
          const results = await bounded(
            Promise.allSettled(initializers.map(stopInitializer)),
            "initializer cleanup",
            cleanupDeadlineMs,
          );
          if (results.some((result) => result.status === "rejected")) {
            preserveTemporaryState();
            throw new Error("Could not confirm every initializer child settled.");
          }
        } catch (error) {
          preserveTemporaryState();
          throw error;
        }
      }),
  );

type TemporaryDirectory = {
  readonly directory: string;
  preserve: boolean;
};

const withTemporaryDirectory = <A, E, R>(
  prefix: string,
  use: (temporary: TemporaryDirectory) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | unknown, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => ({ directory: mkdtempSync(join(tmpdir(), prefix)), preserve: false })),
    use,
    (temporary) =>
      Effect.sync(() => {
        if (!temporary.preserve) rmSync(temporary.directory, { recursive: true, force: true });
      }),
  );

const withHeldWriteLock = <A, E>(
  statePath: string,
  use: () => Effect.Effect<A, E>,
  createMigrationLedger = false,
): Effect.Effect<A, E | unknown> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const database = new DatabaseSync(statePath, { timeout: 0 });
      if (createMigrationLedger) {
        database.exec(`
            CREATE TABLE IF NOT EXISTS effect_sql_migrations (
              migration_id INTEGER PRIMARY KEY NOT NULL,
              created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              name VARCHAR(255) NOT NULL
            )
          `);
      }
      database.exec("BEGIN IMMEDIATE");
      return database;
    }),
    use,
    (database) =>
      Effect.sync(() => {
        try {
          database.exec("ROLLBACK");
        } finally {
          database.close();
        }
      }),
  );

const lastJsonLine = (stdout: string): unknown => {
  const line = stdout.trim().split("\n").at(-1);
  if (line === undefined) throw new Error(`Process did not produce JSON: ${stdout}`);
  return JSON.parse(line);
};

describe("Shared Repository State initialization coordination", () => {
  it.live("produces complete baseline state when two processes initialize one absent path", () =>
    withTemporaryDirectory("but-why-concurrent-init-", (temporary) =>
      runConcurrentInitializers(
        join(temporary.directory, "state.sqlite"),
        temporary.directory,
        () => {
          temporary.preserve = true;
        },
      ).pipe(
        Effect.flatMap((results) => {
          for (const result of results) {
            expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
            expect(lastJsonLine(result.stdout)).toEqual({
              ok: true,
              migrations: [1, 2, 3],
              identity: { commonDirectory: temporary.directory, idPrefix: "BY" },
            });
          }

          return Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              const migrations = yield* repository.operation(
                "verify concurrent migration ledger",
                (sql) => sql<{ readonly migrationId: number }>`
                  SELECT migration_id AS migrationId
                  FROM effect_sql_migrations
                  ORDER BY migration_id
                `,
              );
              expect(migrations).toEqual([
                { migrationId: 1 },
                { migrationId: 2 },
                { migrationId: 3 },
              ]);
            }).pipe(
              Effect.provide(
                repositorySqlLayer({
                  statePath: join(temporary.directory, "state.sqlite"),
                  commonDirectory: temporary.directory,
                }),
              ),
            ),
          ).pipe(Effect.timeout(observationDeadlineMs));
        }),
      ),
    ).pipe(Effect.timeout(outerTestDeadline)),
  );

  it.live(
    "returns bounded unavailability under migration contention and recovers after release",
    () =>
      withTemporaryDirectory("but-why-migration-contention-", (temporary) => {
        const statePath = join(temporary.directory, "state.sqlite");
        return withHeldWriteLock(
          statePath,
          () => {
            const startedAt = performance.now();
            return Effect.either(
              Effect.scoped(
                RepositorySql.pipe(
                  Effect.provide(
                    repositorySqlLayer({
                      statePath,
                      commonDirectory: temporary.directory,
                      lifecycle: "initialize",
                      sqliteBusyTimeoutMs: 50,
                      migrationContentionTimeoutMs: 250,
                      migrationContentionRetryDelayMs: 20,
                    }),
                  ),
                ),
              ).pipe(Effect.timeout(operationDeadlineMs)),
            ).pipe(
              Effect.flatMap((contended) => {
                expect(contended._tag).toBe("Left");
                if (contended._tag === "Left") {
                  expect(contended.left).toBeInstanceOf(RepositoryStateUnavailable);
                }
                expect(performance.now() - startedAt).toBeLessThan(operationDeadlineMs);
                return Effect.void;
              }),
            );
          },
          true,
        ).pipe(
          Effect.zipRight(
            Effect.scoped(
              Effect.gen(function* () {
                const repository = yield* RepositorySql;
                const migrations = yield* repository.operation(
                  "verify recovered migration ledger",
                  (sql) => sql<{ readonly migrationId: number }>`
                  SELECT migration_id AS migrationId
                  FROM effect_sql_migrations
                  ORDER BY migration_id
                `,
                );
                expect(migrations).toEqual([
                  { migrationId: 1 },
                  { migrationId: 2 },
                  { migrationId: 3 },
                ]);
              }).pipe(
                Effect.provide(
                  repositorySqlLayer({
                    statePath,
                    commonDirectory: temporary.directory,
                    lifecycle: "initialize",
                  }),
                ),
              ),
            ).pipe(Effect.timeout(operationDeadlineMs)),
          ),
        );
      }).pipe(Effect.timeout(outerTestDeadline)),
  );

  it.live("opens current state while another connection holds a migration write transaction", () =>
    withTemporaryDirectory("but-why-current-open-", (temporary) => {
      const statePath = join(temporary.directory, "state.sqlite");
      const initialize = Effect.scoped(
        Effect.gen(function* () {
          const repository = yield* RepositorySql;
          const migrations = yield* repository.operation(
            "prime current migration ledger",
            (sql) => sql<{ readonly migrationId: number }>`
              SELECT migration_id AS migrationId
              FROM effect_sql_migrations
              ORDER BY migration_id
            `,
          );
          expect(migrations).toEqual([
            { migrationId: 1 },
            { migrationId: 2 },
            { migrationId: 3 },
          ]);
        }).pipe(
          Effect.provide(
            repositorySqlLayer({
              statePath,
              commonDirectory: temporary.directory,
              lifecycle: "initialize",
            }),
          ),
        ),
      ).pipe(Effect.timeout(operationDeadlineMs));
      return initialize.pipe(
        Effect.zipRight(
          withHeldWriteLock(statePath, () =>
            Effect.scoped(
              Effect.gen(function* () {
                const repository = yield* RepositorySql;
                const migrations = yield* repository.operation(
                  "read current migration ledger while locked",
                  (sql) => sql<{ readonly migrationId: number }>`
                    SELECT migration_id AS migrationId
                    FROM effect_sql_migrations
                    ORDER BY migration_id
                  `,
                );
                return migrations;
              }).pipe(
                Effect.provide(
                  repositorySqlLayer({
                    statePath,
                    commonDirectory: temporary.directory,
                    sqliteBusyTimeoutMs: 50,
                  }),
                ),
              ),
            ).pipe(Effect.timeout(operationDeadlineMs)),
          ).pipe(
            Effect.map((migrations) => {
              expect(migrations).toEqual([
                { migrationId: 1 },
                { migrationId: 2 },
                { migrationId: 3 },
              ]);
              return migrations;
            }),
          ),
        ),
      );
    }).pipe(Effect.timeout(outerTestDeadline)),
  );
});
