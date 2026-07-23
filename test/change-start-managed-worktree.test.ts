import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { provisionChangeWorktree } from "../src/change/changeStartGit.js";
import type { ChangeStartRecord } from "../src/change/changeStartStore.js";
import { runByInProcessEffect } from "./support/by-cli.js";
import { createInitializedRepo } from "./support/initializedRepo.js";

const now = "2026-06-30T12:00:00.000Z";

describe("Change Start Managed Worktree boundaries", () => {
  it.effect("creates a ready taskless Change from the local default branch", () =>
    Effect.gen(function* () {
      const root = initializedRepository();
      writeFileSync(join(root, "dirty.txt"), "caller work is not part of Change Start\n");

      const result = yield* runByInProcessEffect(
        root,
        ["change", "start", "--output", "json"],
        now,
      );

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout) as ChangeOutput;
      const startingCommit = git(root, "rev-parse", "refs/heads/main^{commit}");
      expect(output).toMatchObject({
        change: { id: expect.any(String), taskId: null, readiness: "ready" },
        branch: expect.stringMatching(/^refs\/heads\/but-why\/change-/u),
        baseRef: "refs/heads/main",
        startingCommit,
        worktreePath: expect.any(String),
      });
      expect(git(output.worktreePath, "symbolic-ref", "HEAD")).toBe(output.branch);
      expect(git(output.worktreePath, "rev-parse", "HEAD^{commit}")).toBe(startingCommit);
      expect(existsSync(join(output.worktreePath, "dirty.txt"))).toBe(false);
    }),
  );

  it("preserves unexpected branches and occupied Managed Worktree paths", () => {
    const root = initializedRepository();
    const start = changeStartRecord(root);
    git(root, "branch", start.branchRef.slice("refs/heads/".length), start.startingCommit);

    expect(provisionChangeWorktree(root, start, false)).toEqual({
      ok: false,
      code: "change_start_conflict",
    });

    git(root, "branch", "-D", start.branchRef.slice("refs/heads/".length));
    mkdirSync(start.worktreePath, { recursive: true });
    writeFileSync(join(start.worktreePath, "keep.txt"), "do not overwrite\n");
    expect(provisionChangeWorktree(root, start, false)).toEqual({
      ok: false,
      code: "change_start_conflict",
    });
    expect(existsSync(join(start.worktreePath, "keep.txt"))).toBe(true);

    rmSync(start.worktreePath, { recursive: true });
    expect(provisionChangeWorktree(root, start, false)).toEqual({ ok: true });
    expect(git(start.worktreePath, "symbolic-ref", "HEAD")).toBe(start.branchRef);
  });
});

type ChangeOutput = {
  readonly change: {
    readonly id: string;
    readonly taskId: string | null;
    readonly readiness: string;
  };
  readonly branch: string;
  readonly baseRef: string;
  readonly startingCommit: string;
  readonly worktreePath: string;
};

const initializedRepository = (): string => {
  const root = createInitializedRepo();
  git(root, "config", "user.name", "But Why Test");
  git(root, "config", "user.email", "but-why@example.test");
  git(root, "branch", "-M", "main");
  writeFileSync(join(root, "README.md"), "# Test repository\n");
  git(root, "add", "README.md", ".gitignore", ".but-why/config.json");
  git(root, "commit", "-m", "Initialize repository");
  git(root, "remote", "add", "origin", root);
  git(root, "update-ref", "refs/remotes/origin/main", "refs/heads/main");
  git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  return root;
};

const changeStartRecord = (root: string): ChangeStartRecord => {
  const commonDirectory = git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
  return {
    id: "change-1",
    repositoryCommonDirectory: commonDirectory,
    branchRef: "refs/heads/but-why/change-1",
    baseRef: "refs/heads/main",
    taskId: null,
    startingCommit: git(root, "rev-parse", "refs/heads/main"),
    worktreePath: join(commonDirectory, "but-why", "worktrees", "change-1"),
    acceptanceContext: null,
    readiness: "pending",
    prepare: null,
    prepareFailure: null,
    publication: null,
    cleanup: { state: "pending", blockingReason: null },
    state: "open",
    closeReason: null,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
  };
};

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
