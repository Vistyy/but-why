import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";
import { openSqliteChangePersistence } from "../../src/sqlite/sqliteChangePersistence.js";
import { openSqliteChangeStartPersistence } from "../../src/sqlite/sqliteChangeStartPersistence.js";
import { commitButWhyConfigAndRecordDefault, runByInProcessEffect } from "../support/by-cli.js";
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
    15_000,
  );

  it.effect(
    "reports pending discard with the exact retry command",
    () =>
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
        expect(stdout.help.join(" ")).toContain(
          "by change reconcile change-pending --discard-work",
        );
        expect(existsSync(actualWorktree)).toBe(true);
      }),
    15_000,
  );
});

const git = (cwd: string, ...args: readonly string[]): string =>
  runTestProcessOrThrow("git", args, { cwd });
