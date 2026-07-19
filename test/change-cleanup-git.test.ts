import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { cleanupChangeResources } from "../src/change/localChangeCleanupGit.js";
import { cleanupTempRoots, createTempRoot } from "./support/by-cli.js";

afterEach(cleanupTempRoots);

describe("Change cleanup Git adapter", () => {
  it("preserves a dirty Managed Worktree and its branch", () => {
    const repository = initializedRepository();
    const worktreePath = join(repository, "feature-worktree");
    git(repository, "worktree", "add", "-b", "feature", worktreePath, "main");
    writeFileSync(join(worktreePath, "uncommitted.txt"), "preserve this work\n");

    expect(
      cleanupChangeResources({
        repositoryCommonDirectory: git(
          repository,
          "rev-parse",
          "--path-format=absolute",
          "--git-common-dir",
        ),
        worktreePath,
        branchRef: "refs/heads/feature",
      }),
    ).toEqual({
      state: "pending",
      blockingReason: "worktree_has_uncommitted_changes",
    });
    expect(existsSync(worktreePath)).toBe(true);
    expect(git(repository, "rev-parse", "refs/heads/feature")).not.toBe("");
  });

  it("removes a clean Managed Worktree but retains an unreachable branch", () => {
    const repository = initializedRepository();
    const worktreePath = join(repository, "feature-worktree");
    git(repository, "worktree", "add", "-b", "feature", worktreePath, "main");
    writeFileSync(join(worktreePath, "feature.txt"), "unmerged work\n");
    git(worktreePath, "add", "feature.txt");
    git(worktreePath, "commit", "-m", "Feature");

    expect(
      cleanupChangeResources({
        repositoryCommonDirectory: git(
          repository,
          "rev-parse",
          "--path-format=absolute",
          "--git-common-dir",
        ),
        worktreePath,
        branchRef: "refs/heads/feature",
      }),
    ).toEqual({
      state: "pending",
      blockingReason: "branch_not_reachable_from_another_ref",
    });
    expect(existsSync(worktreePath)).toBe(false);
    expect(git(repository, "branch", "--list", "feature")).toBe("feature");
  });

  it("removes a clean Managed Worktree and deletes a branch reachable through another ref", () => {
    const repository = initializedRepository();
    const worktreePath = join(repository, "feature-worktree");
    git(repository, "worktree", "add", "-b", "feature", worktreePath, "main");
    writeFileSync(join(worktreePath, "feature.txt"), "merged work\n");
    git(worktreePath, "add", "feature.txt");
    git(worktreePath, "commit", "-m", "Feature");
    git(repository, "merge", "--ff-only", "feature");

    expect(
      cleanupChangeResources({
        repositoryCommonDirectory: git(
          repository,
          "rev-parse",
          "--path-format=absolute",
          "--git-common-dir",
        ),
        worktreePath,
        branchRef: "refs/heads/feature",
      }),
    ).toEqual({ state: "complete" });
    expect(existsSync(worktreePath)).toBe(false);
    expect(git(repository, "branch", "--list", "feature")).toBe("");
  });
});

const initializedRepository = (): string => {
  const repository = createTempRoot();
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "But Why Test");
  git(repository, "config", "user.email", "but-why@example.test");
  writeFileSync(join(repository, "README.md"), "# Test repository\n");
  git(repository, "add", "README.md");
  git(repository, "commit", "-m", "Initialize repository");
  git(repository, "branch", "-M", "main");
  return repository;
};

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
