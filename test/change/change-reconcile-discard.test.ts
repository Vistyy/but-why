import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";
import type { ChangeCleanupOperation } from "../../src/change/cleanupTerminalChange.js";
import { openChangeReconciliation } from "../../src/change/reconcileChange.js";
import type { RepositoryStorageError } from "../../src/contracts/repositoryStorageError.js";
import {
  RepositorySql,
  type RepositorySqlConfig,
  repositorySqlLayer,
} from "../../src/sqlite/repositorySql.js";
import { openSqliteTaskChangeStartPersistence as openSqliteChangeStartPersistence } from "../../src/taskChange/adapters/sqlite/sqliteTaskChangeStartPersistence.js";
import { openSqliteChangeTestDependencies } from "../support/changePorts.js";
import {
  noOpTerminalCleanupDependencies,
  openTerminalCleanup,
} from "../support/terminalCleanup.js";
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
      const commonDirectory = join(root, ".git");
      const statePath = join(commonDirectory, "but-why", "state.sqlite");
      mkdirSync(join(commonDirectory, "but-why"), { recursive: true });
      return { root, commonDirectory, statePath };
    }),
    (fixture) =>
      use(fixture).pipe(Effect.provide(repositorySqlLayer(sqlConfig(fixture))), Effect.scoped),
    (fixture) => Effect.sync(() => rmSync(fixture.root, { recursive: true, force: true })),
  );

const sqlConfig = (fixture: ReconcileFixture): RepositorySqlConfig => ({
  commonDirectory: fixture.commonDirectory,
  statePath: fixture.statePath,
  lifecycle: "initialize",
});

const createTerminalChange = (fixture: ReconcileFixture, id: string) =>
  Effect.gen(function* () {
    const starts = yield* openSqliteChangeStartPersistence();
    const changes = yield* openSqliteChangeTestDependencies();
    const worktreePath = join(fixture.root, "worktrees", "but-why", id);

    const created = yield* starts.create({
      id,
      repositoryCommonDirectory: fixture.commonDirectory,
      branchRef: `refs/heads/but-why/${id}`,
      baseRef: "refs/heads/main",
      baseRemoteUrl: "https://github.com/acme/repo.git",
      startingCommit: "base",
      worktreePath,
      now,
      reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
    });
    if (!created.ok) throw new Error(created.code);
    yield* starts.recordPrepareOutcome(created.change.id, null, now);
    const cancelled = yield* changes.delivery.cancelChange({
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
    "forwards one-attempt discard authority for dirty Managed Worktree and unique Repository Branch work",
    () =>
      withReconcileRepository((fixture) =>
        Effect.gen(function* () {
          const changes = yield* openSqliteChangeTestDependencies();
          const first = yield* createTerminalChange(fixture, "change-a");
          const second = yield* createTerminalChange(fixture, "change-b");
          const cleanupInputs: Parameters<ChangeCleanupOperation>[0][] = [];
          const cleanupDirtyManagedWorktreeAndUniqueBranch: ChangeCleanupOperation = (input) => {
            cleanupInputs.push(input);
            return input.discardWork === true
              ? { state: "complete" }
              : { state: "pending", blockingReason: "work_preserved" };
          };
          const reconciliation = openChangeReconciliation({
            persistence: {
              getChangeById: changes.delivery.getChangeById,
              listChangesForReconciliation: changes.delivery.listChangesForReconciliation,
              completeMergedChange: changes.delivery.completeMergedChange,
            },
            github: noPullRequestGateway,
            executionLock: { withLock: ({ effect }) => effect },
            cleanupTerminal: openTerminalCleanup({
              ...noOpTerminalCleanupDependencies,
              persistence: {
                recordCleanup: changes.delivery.recordCleanup,
              },
              cleanup: cleanupDirtyManagedWorktreeAndUniqueBranch,
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
          expect(cleanupInputs).toEqual([
            {
              repositoryCommonDirectory: fixture.commonDirectory,
              worktreePath: first.worktreePath,
              branchRef: "refs/heads/but-why/change-a",
              remoteChangeBranch: null,
              discardWork: true,
            },
          ]);
          expect(yield* changes.reads.getChangeById(first.changeId)).toMatchObject({
            cleanup: { state: "complete", blockingReason: null },
          });
          expect(yield* changes.reads.getChangeById(second.changeId)).toMatchObject({
            cleanup: { state: "pending", blockingReason: null },
          });
        }),
      ),
    30_000,
  );

  it.effect("withholds discard authority without the discard flag", () =>
    withReconcileRepository((fixture) =>
      Effect.gen(function* () {
        const changes = yield* openSqliteChangeTestDependencies();
        const terminal = yield* createTerminalChange(fixture, "change-a");
        const cleanupInputs: Parameters<ChangeCleanupOperation>[0][] = [];
        const reconciliation = openChangeReconciliation({
          persistence: {
            getChangeById: changes.delivery.getChangeById,
            listChangesForReconciliation: changes.delivery.listChangesForReconciliation,
            completeMergedChange: changes.delivery.completeMergedChange,
          },
          github: noPullRequestGateway,
          executionLock: { withLock: ({ effect }) => effect },
          cleanupTerminal: openTerminalCleanup({
            ...noOpTerminalCleanupDependencies,
            persistence: {
              recordCleanup: changes.delivery.recordCleanup,
            },
            cleanup: (input) => {
              cleanupInputs.push(input);
              return {
                state: "pending",
                blockingReason: "worktree_has_uncommitted_changes",
              };
            },
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
        expect(cleanupInputs).toEqual([
          {
            repositoryCommonDirectory: fixture.commonDirectory,
            worktreePath: terminal.worktreePath,
            branchRef: "refs/heads/but-why/change-a",
            remoteChangeBranch: null,
            discardWork: false,
          },
        ]);
      }),
    ),
  );

  it.effect("rejects discard for an open Change before observing the owned pull request", () =>
    withReconcileRepository((fixture) =>
      Effect.gen(function* () {
        const starts = yield* openSqliteChangeStartPersistence();
        const changes = yield* openSqliteChangeTestDependencies();
        const worktreePath = join(fixture.root, "worktrees", "but-why", "change-open");
        const created = yield* starts.create({
          id: "change-open",
          repositoryCommonDirectory: fixture.commonDirectory,
          branchRef: "refs/heads/but-why/change-open",
          baseRef: "refs/heads/main",
          baseRemoteUrl: "https://github.com/acme/repo.git",
          startingCommit: "base",
          worktreePath,
          now,
          reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
        });
        if (!created.ok) throw new Error(created.code);
        yield* starts.recordPrepareOutcome(created.change.id, null, now);
        const reconciliation = openChangeReconciliation({
          persistence: {
            getChangeById: changes.delivery.getChangeById,
            listChangesForReconciliation: changes.delivery.listChangesForReconciliation,
            completeMergedChange: changes.delivery.completeMergedChange,
          },
          github: noPullRequestGateway,
          executionLock: { withLock: ({ effect }) => effect },
          cleanupTerminal: openTerminalCleanup({
            ...noOpTerminalCleanupDependencies,
            persistence: {
              recordCleanup: changes.delivery.recordCleanup,
            },
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
        expect(yield* changes.reads.getChangeById(created.change.id)).toMatchObject({
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

        const changes = yield* openSqliteChangeTestDependencies();
        const terminal = yield* createTerminalChange(fixture, "change-a");
        const reconciliation = openChangeReconciliation({
          persistence: {
            getChangeById: changes.delivery.getChangeById,
            listChangesForReconciliation: changes.delivery.listChangesForReconciliation,
            completeMergedChange: changes.delivery.completeMergedChange,
          },
          github: noPullRequestGateway,
          executionLock: { withLock: ({ effect }) => effect },
          cleanupTerminal: openTerminalCleanup({
            ...noOpTerminalCleanupDependencies,
            persistence: {
              recordCleanup: changes.delivery.recordCleanup,
            },
            cleanup: () => ({ state: "complete" }),
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

        const recorded = yield* changes.reads.getChangeById(terminal.changeId);
        expect(recorded).toBeDefined();
        expect("discardWork" in (recorded ?? {})).toBe(false);
        expect(recorded?.cleanup).toEqual({ state: "complete", blockingReason: null });
      }),
    ),
  );
});
