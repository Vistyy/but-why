import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";
import { taskChangeStartChangeOperations } from "../../src/change/composition/loadChangePersistence.js";
import { openSqliteExecutionLock } from "../../src/repositoryRuntime/adapters/sqlite/sqliteExecutionLock.js";
import { openSqliteTaskChangeStartPersistence as openSqliteChangeStartPersistence } from "../../src/taskChange/adapters/sqlite/sqliteTaskChangeStartPersistence.js";
import { taskChangeStartTaskOperations } from "../../src/taskChange/composition/loadTaskChangePersistence.js";
import { commitButWhyConfigAndRecordDefault, runByInProcessEffect } from "../support/by-cli.js";
import { openSqliteChangeTestDependencies } from "../support/changePorts.js";
import { createInitializedRepo } from "../support/initializedRepo.js";
import { withTestRepository } from "../support/repository.js";
import { runTestProcessOrThrow } from "../support/testProcess.js";

const now = "2026-08-05T12:00:00.000Z";

describe("by change reconcile --discard-work", () => {
  it.effect(
    "rejects omitted-ID and bulk --discard-work without one exact Change ID",
    () =>
      Effect.gen(function* () {
        const root = createInitializedRepo();
        const result = yield* runByInProcessEffect(root, ["change", "reconcile", "--discard-work"]);

        expect(result.status).toBe(2);
        expect(JSON.parse(result.stdout)).toMatchObject({
          error: { code: "discard_requires_change_id" },
          help: ["Run `by change reconcile <change-id> --discard-work` for one exact Change."],
        });
      }),
    30_000,
  );

  it.effect(
    "reports retryable contention through the configured Change lock",
    () =>
      Effect.gen(function* () {
        const root = createInitializedRepo();
        commitButWhyConfigAndRecordDefault(root);
        const commonDirectory = join(root, ".git");
        yield* withTestRepository(
          root,
          Effect.gen(function* () {
            const starts = yield* openSqliteChangeStartPersistence(
              taskChangeStartTaskOperations,
              taskChangeStartChangeOperations,
            );
            const changes = yield* openSqliteChangeTestDependencies();
            const created = yield* starts.create({
              baseRef: "refs/heads/main",
              baseRemoteUrl: "https://github.com/acme/repo.git",
              managedWorktreeParent: dirname(join(root, "uncreated-worktree")),
              policy: {
                reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
                prepare: null,
                checks: [{ id: "quality", command: "true", timeoutSeconds: 30 }],
              },
            });
            if (!created.ok) throw new Error(created.code);
            yield* starts.recordPrepareOutcome(created.change.id, null, now);
            const cancelled = yield* changes.delivery.cancelChange({
              changeId: created.change.id,
              reason: "cleanup",
              now,
            });
            if (!cancelled.ok) throw new Error(cancelled.code);
          }),
        );

        const result = yield* openSqliteExecutionLock({ commonDirectory }).withLock({
          owner: "change_submission",
          key: "BY-C1",
          effect: runByInProcessEffect(root, ["change", "reconcile", "BY-C1", "--discard-work"]),
        });

        expect(result.status).toBe(1);
        expect(JSON.parse(result.stdout)).toEqual({
          error: {
            code: "submission_in_progress",
            message: "Another operation owns the Change execution lock.",
            changes: [{ changeId: "BY-C1", status: "submission_in_progress" }],
          },
          help: ["Wait for the current Change operation to finish, then retry reconciliation."],
        });
      }),
    30_000,
  );

  it.effect(
    "reports pending discard with the exact retry command",
    () =>
      Effect.gen(function* () {
        const root = createInitializedRepo();
        commitButWhyConfigAndRecordDefault(root);
        const recordedWorktreePath = join(root, "worktrees", "but-why", "BY-C1");
        const actualWorktree = join(root, "actual", "BY-C1");
        git(root, "worktree", "add", "-b", "but-why/BY-C1", actualWorktree, "main");
        writeFileSync(join(actualWorktree, "feature.txt"), "unique\n");
        git(actualWorktree, "add", "feature.txt");
        git(actualWorktree, "commit", "-m", "Unique");
        mkdirSync(join(root, "actual"), { recursive: true });
        mkdirSync(join(root, "worktrees"), { recursive: true });
        symlinkSync(join(root, "actual"), join(root, "worktrees", "but-why"), "dir");
        yield* withTestRepository(
          root,
          Effect.gen(function* () {
            const starts = yield* openSqliteChangeStartPersistence(
              taskChangeStartTaskOperations,
              taskChangeStartChangeOperations,
            );
            const changes = yield* openSqliteChangeTestDependencies();
            const created = yield* starts.create({
              baseRef: "refs/heads/main",
              baseRemoteUrl: "https://github.com/acme/repo.git",
              managedWorktreeParent: dirname(recordedWorktreePath),
              policy: {
                reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
                prepare: null,
                checks: [{ id: "quality", command: "true", timeoutSeconds: 30 }],
              },
            });
            if (!created.ok) throw new Error(created.code);
            yield* starts.recordPrepareOutcome(created.change.id, null, now);
            const cancelled = yield* changes.delivery.cancelChange({
              changeId: created.change.id,
              reason: "cleanup",
              now,
            });
            if (!cancelled.ok) throw new Error(cancelled.code);
          }),
        );

        const result = yield* runByInProcessEffect(root, [
          "change",
          "reconcile",
          "BY-C1",
          "--discard-work",
        ]);

        expect(result.status).toBe(0);
        const stdout = JSON.parse(result.stdout) as {
          readonly changes: readonly {
            readonly changeId: string;
            readonly status: string;
            readonly cleanup: { readonly state: string; readonly blockingReason: string };
          }[];
          readonly help: readonly string[];
        };
        expect(stdout.changes).toEqual([
          {
            changeId: "BY-C1",
            status: "cleanup_pending",
            cleanup: { state: "pending", blockingReason: "worktree_path_unsafe" },
          },
        ]);
        expect(stdout.help.join(" ")).toContain("by change reconcile BY-C1 --discard-work");
        expect(existsSync(actualWorktree)).toBe(true);
      }),
    30_000,
  );
});

const git = (cwd: string, ...args: readonly string[]): string =>
  runTestProcessOrThrow("git", args, { cwd });
