import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { commitButWhyConfigAndRecordDefault, runByInProcessEffect } from "../support/by-cli.js";
import { createInitializedRepo } from "../support/initializedRepo.js";
import { withTestRepository } from "../support/repository.js";
import { runTestProcess, runTestProcessOrThrow } from "../support/testProcess.js";
import { openSqliteChangePersistence } from "../../src/sqlite/sqliteChangePersistence.js";
import { openSqliteChangeStartPersistence } from "../../src/sqlite/sqliteChangeStartPersistence.js";

const now = "2026-08-05T12:00:00.000Z";

describe("by change reconcile --discard-work", () => {
  it.effect("rejects omitted-ID and bulk --discard-work without one exact Change ID", () =>
    Effect.gen(function* () {
      const root = createInitializedRepo();
      const result = yield* runByInProcessEffect(root, [
        "--json",
        "change",
        "reconcile",
        "--discard-work",
      ]);

      expect(result.status).toBe(2);
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: { code: "discard_requires_change_id" },
        help: ["Run `by change reconcile <change-id> --discard-work` for one exact Change."],
      });
    }),
  );

  it.effect(
    "discards a dirty Managed Worktree and unique branch for one exact terminal Change",
    () =>
      Effect.gen(function* () {
        const root = createInitializedRepo();
        commitButWhyConfigAndRecordDefault(root);
        const commonDirectory = join(root, ".git");
        const worktreePath = join(root, "worktrees", "but-why", "change-a");
        git(root, "worktree", "add", "-b", "but-why/change-a", worktreePath, "main");
        writeFileSync(join(worktreePath, "feature.txt"), "unique A\n");
        git(worktreePath, "add", "feature.txt");
        git(worktreePath, "commit", "-m", "Unique A");
        writeFileSync(join(worktreePath, "dirty.txt"), "uncommitted A\n");
        yield* withTestRepository(
          root,
          Effect.gen(function* () {
            const starts = yield* openSqliteChangeStartPersistence();
            const changes = yield* openSqliteChangePersistence();
            const created = yield* starts.create({
              id: "change-a",
              repositoryCommonDirectory: commonDirectory,
              branchRef: "refs/heads/but-why/change-a",
              baseRef: "refs/heads/main",
              baseRemoteUrl: "https://github.com/acme/repo.git",
              startingCommit: git(root, "rev-parse", "refs/heads/main"),
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
          }),
        );

        const result = yield* runByInProcessEffect(root, [
          "--json",
          "change",
          "reconcile",
          "change-a",
          "--discard-work",
        ]);

        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({
          changes: [
            {
              changeId: "change-a",
              status: "cleanup_complete",
              cleanup: { state: "complete", blockingReason: null },
            },
          ],
        });
        expect(existsSync(worktreePath)).toBe(false);
        expect(branchPresent(root, "but-why/change-a")).toBe(false);
      }),
  );

  it.effect("rejects --discard-work for an open Change", () =>
    Effect.gen(function* () {
      const root = createInitializedRepo();
      commitButWhyConfigAndRecordDefault(root);
      const commonDirectory = join(root, ".git");
      const worktreePath = join(root, "worktrees", "but-why", "change-open");
      git(root, "worktree", "add", "-b", "but-why/change-open", worktreePath, "main");
      yield* withTestRepository(
        root,
        Effect.gen(function* () {
          const starts = yield* openSqliteChangeStartPersistence();
          const created = yield* starts.create({
            id: "change-open",
            repositoryCommonDirectory: commonDirectory,
            branchRef: "refs/heads/but-why/change-open",
            baseRef: "refs/heads/main",
            baseRemoteUrl: "https://github.com/acme/repo.git",
            startingCommit: git(root, "rev-parse", "refs/heads/main"),
            worktreePath,
            now,
          });
          if (!created.ok) throw new Error(created.code);
          yield* starts.recordPrepareOutcome(created.change.id, null, now);
        }),
      );

      const result = yield* runByInProcessEffect(root, [
        "--json",
        "change",
        "reconcile",
        "change-open",
        "--discard-work",
      ]);

      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: {
          code: "discard_open_change",
          changes: [
            {
              changeId: "change-open",
              status: "rejected",
              rejection: "discard_open_change",
            },
          ],
        },
      });
      expect(existsSync(worktreePath)).toBe(true);
    }),
  );

  it.effect("reports pending discard with the exact retry command", () =>
    Effect.gen(function* () {
      const root = createInitializedRepo();
      commitButWhyConfigAndRecordDefault(root);
      const commonDirectory = join(root, ".git");
      const recordedWorktreePath = join(root, "worktrees", "but-why", "change-pending");
      const actualWorktree = join(root, "actual", "change-pending");
      git(root, "worktree", "add", "-b", "but-why/change-pending", actualWorktree, "main");
      writeFileSync(join(actualWorktree, "feature.txt"), "unique\n");
      git(actualWorktree, "add", "feature.txt");
      git(actualWorktree, "commit", "-m", "Unique");
      mkdirSync(join(root, "actual"), { recursive: true });
      mkdirSync(join(root, "worktrees"), { recursive: true });
      symlinkSync(join(root, "actual"), join(root, "worktrees", "but-why"), "dir");
      yield* withTestRepository(
        root,
        Effect.gen(function* () {
          const starts = yield* openSqliteChangeStartPersistence();
          const changes = yield* openSqliteChangePersistence();
          const created = yield* starts.create({
            id: "change-pending",
            repositoryCommonDirectory: commonDirectory,
            branchRef: "refs/heads/but-why/change-pending",
            baseRef: "refs/heads/main",
            baseRemoteUrl: "https://github.com/acme/repo.git",
            startingCommit: git(root, "rev-parse", "refs/heads/main"),
            worktreePath: recordedWorktreePath,
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
        }),
      );

      const result = yield* runByInProcessEffect(root, [
        "--json",
        "change",
        "reconcile",
        "change-pending",
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
          changeId: "change-pending",
          status: "cleanup_pending",
          cleanup: { state: "pending", blockingReason: "worktree_path_unsafe" },
        },
      ]);
      expect(stdout.help.join(" ")).toContain("by change reconcile change-pending --discard-work");
      expect(existsSync(actualWorktree)).toBe(true);
    }),
  );
});

const git = (cwd: string, ...args: readonly string[]): string =>
  runTestProcessOrThrow("git", args, { cwd });

const branchPresent = (cwd: string, branch: string): boolean =>
  runTestProcess("git", ["rev-parse", "--verify", `refs/heads/${branch}`], { cwd }).status === 0;
