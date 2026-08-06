import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { cleanupChangeResources } from "../../src/change/localChangeCleanupGit.js";
import { openTerminalCleanup } from "../../src/change/cleanupTerminalChange.js";
import { openChangeReconciliation } from "../../src/change/reconcileChange.js";
import { openSqliteChangePersistence } from "../../src/sqlite/sqliteChangePersistence.js";
import { openSqliteChangeStartPersistence } from "../../src/sqlite/sqliteChangeStartPersistence.js";
import {
  RepositorySql,
  repositorySqlLayer,
  type RepositorySqlConfig,
} from "../../src/sqlite/repositorySql.js";
import type { RepositoryStorageError } from "../../src/contracts/repositoryStorageError.js";
import { runTestProcess, runTestProcessOrThrow } from "../support/testProcess.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const now = "2026-08-05T12:00:00.000Z";

type ReconcileFixture = {
  readonly root: string;
  readonly commonDirectory: string;
  readonly statePath: string;
};

const withReconcileRepository = <A, E>(
  use: (fixture: ReconcileFixture) => Effect.Effect<A, E, RepositorySql>,
): Effect.Effect<A, E | RepositoryStorageError> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const root = createTestWorkspace();
      git(root, "init", "-q");
      git(root, "config", "user.name", "But Why Test");
      git(root, "config", "user.email", "but-why@example.test");
      writeFileSync(join(root, "README.md"), "# Test repository\n");
      git(root, "add", "README.md");
      git(root, "commit", "-m", "Initialize repository");
      git(root, "branch", "-M", "main");
      const statePath = join(root, ".git", "but-why", "state.sqlite");
      mkdirSync(join(root, ".git", "but-why"), { recursive: true });
      return { root, commonDirectory: join(root, ".git"), statePath };
    }),
    (fixture) =>
      use(fixture).pipe(Effect.provide(repositorySqlLayer(sqlConfig(fixture))), Effect.scoped),
    (fixture) => Effect.sync(() => rmSync(fixture.root, { recursive: true, force: true })),
  );

const sqlConfig = (fixture: ReconcileFixture): RepositorySqlConfig => ({
  commonDirectory: fixture.commonDirectory,
  statePath: fixture.statePath,
});

const createTerminalChange = (fixture: ReconcileFixture, id: string) =>
  Effect.gen(function* () {
    const starts = yield* openSqliteChangeStartPersistence();
    const changes = yield* openSqliteChangePersistence();
    const worktreePath = join(fixture.root, "worktrees", "but-why", id);
    git(fixture.root, "worktree", "add", "-b", `but-why/${id}`, worktreePath, "main");
    writeFileSync(join(worktreePath, "feature.txt"), `unique ${id}\n`);
    git(worktreePath, "add", "feature.txt");
    git(worktreePath, "commit", "-m", `Unique ${id}`);
    writeFileSync(join(worktreePath, "dirty.txt"), `uncommitted ${id}\n`);

    const created = yield* starts.create({
      id,
      repositoryCommonDirectory: fixture.commonDirectory,
      branchRef: `refs/heads/but-why/${id}`,
      baseRef: "refs/heads/main",
      baseRemoteUrl: "https://github.com/acme/repo.git",
      startingCommit: git(fixture.root, "rev-parse", "refs/heads/main"),
      worktreePath,
      now,
    });
    if (!created.ok) throw new Error(created.code);
    yield* starts.recordPrepareOutcome(created.change.id, null, now);
    const cancelled = yield* changes.cancelChange({
      changeId: created.change.id,
      reason: "cleanup",
      now,
    });
    if (!cancelled.ok) throw new Error(cancelled.code);
    return { changeId: created.change.id, worktreePath };
  });

const noPullRequestGateway = {
  findPullRequests: () => {
    throw new Error("Discard reconciliation must not observe pull requests");
  },
  getPullRequest: () => {
    throw new Error("Discard reconciliation must not observe pull requests");
  },
  createPullRequest: () => {
    throw new Error("Reconciliation must not create a pull request");
  },
  updatePullRequest: () => {
    throw new Error("Reconciliation must not update a pull request");
  },
};

describe("Change reconciliation discard boundary", () => {
  it.effect(
    "discards a dirty Managed Worktree and unique local work for one exact terminal Change only",
    () =>
      withReconcileRepository((fixture) =>
        Effect.gen(function* () {
          const changes = yield* openSqliteChangePersistence();
          const first = yield* createTerminalChange(fixture, "change-a");
          const second = yield* createTerminalChange(fixture, "change-b");
          const reconciliation = openChangeReconciliation({
            persistence: changes,
            github: noPullRequestGateway,
            cleanupTerminal: openTerminalCleanup({
              persistence: changes,
              cleanup: (input) => cleanupChangeResources(input),
            }),
          });

          const result = yield* reconciliation.reconcile({
            repositoryCommonDirectory: fixture.commonDirectory,
            changeId: first.changeId,
            now,
            discardWork: true,
          });

          expect(result).toEqual({
            rejected: false,
            changes: [
              {
                changeId: first.changeId,
                status: "cleanup_complete",
                cleanup: { state: "complete", blockingReason: null },
              },
            ],
          });
          expect(existsSync(first.worktreePath)).toBe(false);
          expect(branchPresent(fixture.root, "but-why/change-a")).toBe(false);
          expect(existsSync(second.worktreePath)).toBe(true);
          expect(branchPresent(fixture.root, "but-why/change-b")).toBe(true);
          expect(existsSync(join(second.worktreePath, "dirty.txt"))).toBe(true);
          expect(existsSync(join(second.worktreePath, "feature.txt"))).toBe(true);

          const recorded = yield* changes.getChangeById(first.changeId);
          expect(recorded?.cleanup).toEqual({ state: "complete", blockingReason: null });
        }),
      ),
    30_000,
  );

  it.effect("preserves dirty work and unique local commits without the discard flag", () =>
    withReconcileRepository((fixture) =>
      Effect.gen(function* () {
        const changes = yield* openSqliteChangePersistence();
        const terminal = yield* createTerminalChange(fixture, "change-a");
        const reconciliation = openChangeReconciliation({
          persistence: changes,
          github: noPullRequestGateway,
          cleanupTerminal: openTerminalCleanup({
            persistence: changes,
            cleanup: (input) => cleanupChangeResources(input),
          }),
        });

        const result = yield* reconciliation.reconcile({
          repositoryCommonDirectory: fixture.commonDirectory,
          changeId: terminal.changeId,
          now,
        });

        expect(result).toEqual({
          rejected: false,
          changes: [
            {
              changeId: terminal.changeId,
              status: "cleanup_pending",
              cleanup: {
                state: "pending",
                blockingReason: "worktree_has_uncommitted_changes",
              },
            },
          ],
        });
        expect(existsSync(terminal.worktreePath)).toBe(true);
        expect(branchPresent(fixture.root, "but-why/change-a")).toBe(true);
        expect(existsSync(join(terminal.worktreePath, "dirty.txt"))).toBe(true);
        expect(existsSync(join(terminal.worktreePath, "feature.txt"))).toBe(true);
      }),
    ),
  );

  it.effect("rejects discard for an open Change before observing the owned pull request", () =>
    withReconcileRepository((fixture) =>
      Effect.gen(function* () {
        const starts = yield* openSqliteChangeStartPersistence();
        const changes = yield* openSqliteChangePersistence();
        const worktreePath = join(fixture.root, "worktrees", "but-why", "change-open");
        git(fixture.root, "worktree", "add", "-b", "but-why/change-open", worktreePath, "main");
        const created = yield* starts.create({
          id: "change-open",
          repositoryCommonDirectory: fixture.commonDirectory,
          branchRef: "refs/heads/but-why/change-open",
          baseRef: "refs/heads/main",
          baseRemoteUrl: "https://github.com/acme/repo.git",
          startingCommit: git(fixture.root, "rev-parse", "refs/heads/main"),
          worktreePath,
          now,
        });
        if (!created.ok) throw new Error(created.code);
        yield* starts.recordPrepareOutcome(created.change.id, null, now);
        const reconciliation = openChangeReconciliation({
          persistence: changes,
          github: noPullRequestGateway,
          cleanupTerminal: openTerminalCleanup({
            persistence: changes,
            cleanup: () => {
              throw new Error("Open Changes must not be cleaned");
            },
          }),
        });

        const result = yield* reconciliation.reconcile({
          repositoryCommonDirectory: fixture.commonDirectory,
          changeId: created.change.id,
          now,
          discardWork: true,
        });

        expect(result).toEqual({
          rejected: true,
          changes: [
            {
              changeId: created.change.id,
              status: "rejected",
              rejection: "discard_open_change",
            },
          ],
        });
        expect(existsSync(worktreePath)).toBe(true);
        expect(yield* changes.getChangeById(created.change.id)).toMatchObject({
          state: "open",
        });
      }),
    ),
  );

  it.effect("persists no discard authorization or extra cleanup state", () =>
    withReconcileRepository((fixture) =>
      Effect.gen(function* () {
        const repository = yield* RepositorySql;
        const readSchema = (label: string) =>
          repository.operation(
            label,
            (sql) =>
              sql<{
                readonly name: string;
              }>`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
          );
        const readChangesColumns = (label: string) =>
          repository.operation(
            label,
            (sql) => sql<{ readonly name: string }>`PRAGMA table_info(changes)`,
          );
        const schemaBefore = yield* readSchema("read schema before discard");
        const columnsBefore = yield* readChangesColumns("read changes columns before discard");

        const changes = yield* openSqliteChangePersistence();
        const terminal = yield* createTerminalChange(fixture, "change-a");
        const reconciliation = openChangeReconciliation({
          persistence: changes,
          github: noPullRequestGateway,
          cleanupTerminal: openTerminalCleanup({
            persistence: changes,
            cleanup: (input) => cleanupChangeResources(input),
          }),
        });
        const result = yield* reconciliation.reconcile({
          repositoryCommonDirectory: fixture.commonDirectory,
          changeId: terminal.changeId,
          now,
          discardWork: true,
        });
        expect(result.rejected).toBe(false);

        const schemaAfter = yield* readSchema("read schema after discard");
        const columnsAfter = yield* readChangesColumns("read changes columns after discard");
        expect(schemaAfter).toEqual(schemaBefore);
        expect(columnsAfter).toEqual(columnsBefore);
        expect(schemaAfter.map((row) => row.name)).not.toContain("discard");
        expect(columnsAfter.map((row) => row.name)).not.toContain("discard");

        const recorded = yield* changes.getChangeById(terminal.changeId);
        expect(recorded).toBeDefined();
        expect("discardWork" in (recorded ?? {})).toBe(false);
        expect(recorded?.cleanup).toEqual({ state: "complete", blockingReason: null });
      }),
    ),
  );
});

const git = (cwd: string, ...args: readonly string[]): string =>
  runTestProcessOrThrow("git", args, { cwd });

const branchPresent = (cwd: string, branch: string): boolean =>
  runTestProcess("git", ["rev-parse", "--verify", `refs/heads/${branch}`], { cwd }).status === 0;
