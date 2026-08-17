import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { RepositorySql, repositorySqlLayer } from "../../src/sqlite/repositorySql.js";
import { repoRoot } from "../support/by-cli.js";
import { observeUntil } from "../support/observe.js";
import { startTestProcess } from "../support/testProcess.js";

const helperTsxLoader = join(repoRoot, "node_modules/tsx/dist/loader.mjs");
const helperScript = join(repoRoot, "scripts/repository-process-helper.ts");

const runHelperProcess = (
  args: readonly string[],
  cwd: string,
): Promise<{ readonly status: number | null; readonly stdout: string }> =>
  new Promise((resolveResult) => {
    const child = startTestProcess(
      process.execPath,
      ["--import", helperTsxLoader, helperScript, ...args],
      { cwd, timeout: 60_000 },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("close", (status) => resolveResult({ status, stdout: `${stdout}${stderr}`.trim() }));
  });

const startMigrationLockHolder = (statePath: string, releasePath: string) => {
  const child = startTestProcess(
    process.execPath,
    ["--import", helperTsxLoader, helperScript, "hold-lock", statePath, releasePath],
    { cwd: dirname(statePath), timeout: 90_000 },
  );
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const done = new Promise<{ readonly status: number | null; readonly stdout: string }>(
    (resolveResult) => {
      child.on("close", (status) => resolveResult({ status, stdout: output.trim() }));
    },
  );
  return {
    child,
    done,
    get output() {
      return output;
    },
  };
};

const waitForMigrationLock = (holder: ReturnType<typeof startMigrationLockHolder>) =>
  observeUntil({
    description: "the lock holder to acquire the SQLite migration write lock",
    observe: () => holder.output,
    isReady: (value) => value.includes("locked"),
    timeoutMs: 15_000,
  });

describe("Shared Repository State initialization coordination", () => {
  it.effect("produces complete baseline state when separate processes initialize one path", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-concurrent-init-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          const results = yield* Effect.promise(() =>
            Promise.all(
              ["ConcurrentA", "ConcurrentB", "ConcurrentC"].map((title) =>
                runHelperProcess(
                  ["open-state", statePath, directory, "5000", "30000", "50", title],
                  directory,
                ),
              ),
            ),
          );
          for (const result of results) {
            expect(result.status).toBe(0);
            expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, found: true });
          }

          yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              const migrations = yield* repository.operation(
                "read concurrent migration ledger",
                (sql) => sql<{ readonly migrationId: number }>`
                  SELECT migration_id AS migrationId
                  FROM effect_sql_migrations
                  ORDER BY migration_id
                `,
              );
              expect(migrations).toEqual([{ migrationId: 1 }]);
              const identities = yield* repository.operation(
                "read concurrent repository identity",
                (sql) => sql<{ readonly commonDirectory: string; readonly idPrefix: string }>`
                  SELECT common_directory AS commonDirectory, id_prefix AS idPrefix
                  FROM shared_state_identity
                  WHERE id = 1
                `,
              );
              expect(identities).toEqual([{ commonDirectory: directory, idPrefix: "BY" }]);
            }).pipe(Effect.provide(repositorySqlLayer({ commonDirectory: directory, statePath }))),
          );
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.effect(
    "returns an unavailable result after bounded migration contention and then recovers",
    () =>
      Effect.acquireUseRelease(
        Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-migration-contention-"))),
        (directory) =>
          Effect.gen(function* () {
            const statePath = join(directory, "state.sqlite");
            const releasePath = join(directory, "release-migration-lock");
            const holder = startMigrationLockHolder(statePath, releasePath);
            try {
              yield* Effect.promise(() => waitForMigrationLock(holder));

              const contended = yield* Effect.promise(() =>
                runHelperProcess(
                  ["open-state", statePath, directory, "150", "400", "20", "Contended"],
                  directory,
                ),
              );
              expect(contended.status).toBe(1);
              expect(JSON.parse(contended.stdout)).toMatchObject({
                ok: false,
                error: { _tag: "RepositoryStateUnavailable" },
              });

              writeFileSync(releasePath, "release\n");
              const released = yield* Effect.promise(() => holder.done);
              expect(released.status).toBe(0);
              expect(released.stdout).toContain("released");

              const recovered = yield* Effect.promise(() =>
                runHelperProcess(
                  ["open-state", statePath, directory, "5000", "30000", "50", "Recovery"],
                  directory,
                ),
              );
              expect(recovered.status).toBe(0);
              expect(JSON.parse(recovered.stdout)).toMatchObject({ ok: true, found: true });
            } finally {
              if (holder.child.exitCode === null) holder.child.kill("SIGTERM");
            }
          }),
        (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
      ),
  );

  it.effect("opens current baseline state without migration write coordination", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-current-open-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          const primed = yield* Effect.promise(() =>
            runHelperProcess(
              ["open-state", statePath, directory, "5000", "30000", "50", "Prime"],
              directory,
            ),
          );
          expect(primed.status).toBe(0);

          const releasePath = join(directory, "release-current-state-lock");
          const holder = startMigrationLockHolder(statePath, releasePath);
          try {
            yield* Effect.promise(() => waitForMigrationLock(holder));
            const reopened = yield* Effect.promise(() =>
              runHelperProcess(["open-read", statePath, directory, "150", "400", "20"], directory),
            );
            expect(reopened.status).toBe(0);
            expect(JSON.parse(reopened.stdout)).toMatchObject({
              ok: true,
              migrationCount: 1,
            });
            writeFileSync(releasePath, "release\n");
            expect((yield* Effect.promise(() => holder.done)).status).toBe(0);
          } finally {
            if (holder.child.exitCode === null) holder.child.kill("SIGTERM");
          }
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );
});
