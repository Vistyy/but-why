import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { describe } from "vitest";

import type { ReconciliationChange } from "../../src/change/changePorts.js";
import { openChangeReconciliation } from "../../src/change/reconcileChange.js";
import { type ExecutionLock, ExecutionLockUnavailable } from "../../src/contracts/executionLock.js";
import { openSqliteExecutionLock } from "../../src/sqlite/sqliteExecutionLock.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const now = "2026-08-12T12:00:00.000Z";

const terminalChange = (
  id: string,
  cleanup: ReconciliationChange["cleanup"] = { state: "complete", blockingReason: null },
): ReconciliationChange => ({
  id,
  state: "closed",
  repositoryCommonDirectory: "/repo/.git",
  branchRef: `refs/heads/${id}`,
  worktreePath: `/repo/${id}`,
  publication: null,
  cleanup,
  remoteChangeBranch: null,
});

const unusedComplete = () => Effect.die("Merged completion must not run");
const unusedGitHub = {
  getPullRequest: () => {
    throw new Error("GitHub must not be read");
  },
};

describe("Change reconciliation execution locking", () => {
  it.effect("returns contention without effects and continues with a different Change", () =>
    Effect.gen(function* () {
      const busy = terminalChange("busy-change", { state: "pending", blockingReason: null });
      const available = terminalChange("available-change");
      const rereads: string[] = [];
      let cleanupAttempts = 0;
      const executionLock: ExecutionLock = {
        withLock: ({ key, effect }) =>
          key === busy.id
            ? Effect.fail(
                new ExecutionLockUnavailable({
                  owner: "change_submission",
                  key,
                  lockPath: "/lock",
                  cause: "busy",
                }),
              )
            : effect,
      };
      const reconciliation = openChangeReconciliation({
        persistence: {
          listChangesForReconciliation: () => Effect.succeed([busy, available]),
          getChangeById: (changeId) => {
            rereads.push(changeId);
            return Effect.succeed(changeId === available.id ? available : busy);
          },
          completeMergedChange: unusedComplete,
        },
        github: unusedGitHub,
        cleanupTerminal: () => {
          cleanupAttempts += 1;
          return Effect.die("Cleanup must not run");
        },
        executionLock,
      });

      expect(
        yield* reconciliation.reconcile({ repositoryCommonDirectory: "/repo/.git", now }),
      ).toEqual({
        rejected: false,
        changes: [
          { changeId: busy.id, status: "submission_in_progress" },
          {
            changeId: available.id,
            status: "cleanup_complete",
            cleanup: available.cleanup,
          },
        ],
      });
      expect(rereads).toEqual([available.id]);
      expect(cleanupAttempts).toBe(0);
    }),
  );

  it.effect("re-reads current Change state after acquiring its lock", () =>
    Effect.gen(function* () {
      const selected = terminalChange("changed-after-selection", {
        state: "pending",
        blockingReason: null,
      });
      const current = terminalChange(selected.id);
      const events: string[] = [];
      let reads = 0;
      const reconciliation = openChangeReconciliation({
        persistence: {
          listChangesForReconciliation: () => Effect.succeed([]),
          getChangeById: () => {
            reads += 1;
            events.push(`read-${reads}`);
            return Effect.succeed(reads === 1 ? selected : current);
          },
          completeMergedChange: unusedComplete,
        },
        github: unusedGitHub,
        cleanupTerminal: () => Effect.die("Current complete cleanup must not run"),
        executionLock: {
          withLock: ({ effect }) => {
            events.push("lock-acquired");
            return effect;
          },
        },
      });

      expect(
        yield* reconciliation.reconcile({
          repositoryCommonDirectory: "/repo/.git",
          changeId: selected.id,
          now,
        }),
      ).toEqual({
        rejected: false,
        changes: [{ changeId: current.id, status: "cleanup_complete", cleanup: current.cleanup }],
      });
      expect(events).toEqual(["read-1", "lock-acquired", "read-2"]);
    }),
  );

  it.effect("releases the Change lock when reconciliation is interrupted", () =>
    Effect.gen(function* () {
      const change = terminalChange("interrupted-change", {
        state: "pending",
        blockingReason: null,
      });
      const lock = openSqliteExecutionLock({ commonDirectory: createTestWorkspace() });
      const cleanupStarted = yield* Deferred.make<void>();
      const reconciliation = openChangeReconciliation({
        persistence: {
          listChangesForReconciliation: () => Effect.succeed([]),
          getChangeById: () => Effect.succeed(change),
          completeMergedChange: unusedComplete,
        },
        github: unusedGitHub,
        cleanupTerminal: () =>
          Effect.zipRight(Deferred.succeed(cleanupStarted, undefined), Effect.never),
        executionLock: lock,
      });
      const running = yield* Effect.fork(
        reconciliation.reconcile({
          repositoryCommonDirectory: "/repo/.git",
          changeId: change.id,
          now,
        }),
      );

      yield* Deferred.await(cleanupStarted);
      const contended = yield* lock
        .withLock({
          owner: "change_submission",
          key: change.id,
          effect: Effect.void,
        })
        .pipe(Effect.either);
      expect(contended._tag).toBe("Left");

      yield* Fiber.interrupt(running);
      expect(
        yield* lock.withLock({
          owner: "change_submission",
          key: change.id,
          effect: Effect.succeed("released"),
        }),
      ).toBe("released");
    }),
  );
});
