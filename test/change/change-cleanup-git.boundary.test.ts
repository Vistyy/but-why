import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { cleanupChangeResources } from "../../src/change/localChangeCleanupGit.js";
import { createTestWorkspace } from "../support/testWorkspace.js";
import { runTestProcessOrThrow } from "../support/testProcess.js";

describe("Change cleanup Git adapter", () => {
  it("removes empty sibling containers after the final Managed Worktree", () => {
    const repository = initializedRepository();
    const siblingRoot = join(dirname(repository), `${basename(repository)}-worktrees`);
    const butWhyContainer = join(siblingRoot, "but-why");
    const worktreePath = join(butWhyContainer, "feature");
    git(repository, "worktree", "add", "-b", "feature", worktreePath, "main");

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
    expect(existsSync(butWhyContainer)).toBe(false);
    expect(existsSync(siblingRoot)).toBe(false);
  });

  it("preserves sibling containers that contain another entry", () => {
    const repository = initializedRepository();
    const siblingRoot = join(dirname(repository), `${basename(repository)}-worktrees`);
    const butWhyContainer = join(siblingRoot, "but-why");
    const worktreePath = join(butWhyContainer, "feature");
    git(repository, "worktree", "add", "-b", "feature", worktreePath, "main");
    mkdirSync(join(butWhyContainer, "keep"));

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
    expect(existsSync(butWhyContainer)).toBe(true);
    expect(existsSync(siblingRoot)).toBe(true);
  });

  it("removes the empty But Why container but preserves a non-empty sibling root", () => {
    const repository = initializedRepository();
    const siblingRoot = join(dirname(repository), `${basename(repository)}-worktrees`);
    const butWhyContainer = join(siblingRoot, "but-why");
    const worktreePath = join(butWhyContainer, "feature");
    git(repository, "worktree", "add", "-b", "feature", worktreePath, "main");
    writeFileSync(join(siblingRoot, "keep.txt"), "preserve this entry\n");

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
    expect(existsSync(butWhyContainer)).toBe(false);
    expect(existsSync(siblingRoot)).toBe(true);
  });

  it("cleans a legacy Managed Worktree without removing Shared Repository State", () => {
    const repository = initializedRepository();
    const commonDirectory = git(
      repository,
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    );
    const sharedStatePath = join(commonDirectory, "but-why", "state.sqlite");
    const worktreePath = join(commonDirectory, "but-why", "worktrees", "feature");
    mkdirSync(dirname(sharedStatePath), { recursive: true });
    writeFileSync(sharedStatePath, "shared state\n");
    git(repository, "worktree", "add", "-b", "feature", worktreePath, "main");

    expect(
      cleanupChangeResources({
        repositoryCommonDirectory: commonDirectory,
        worktreePath,
        branchRef: "refs/heads/feature",
      }),
    ).toEqual({ state: "complete" });
    expect(existsSync(worktreePath)).toBe(false);
    expect(existsSync(sharedStatePath)).toBe(true);
  });

  it("preserves a Managed Worktree behind a symlinked sibling container", () => {
    const repository = initializedRepository();
    const siblingRoot = join(dirname(repository), `${basename(repository)}-worktrees`);
    const symlinkTarget = join(dirname(repository), `${basename(repository)}-symlink-target`);
    const actualWorktree = join(symlinkTarget, "but-why", "feature");
    git(repository, "worktree", "add", "-b", "feature", actualWorktree, "main");
    symlinkSync(symlinkTarget, siblingRoot, "dir");
    const recordedWorktreePath = join(siblingRoot, "but-why", "feature");

    expect(
      cleanupChangeResources({
        repositoryCommonDirectory: git(
          repository,
          "rev-parse",
          "--path-format=absolute",
          "--git-common-dir",
        ),
        worktreePath: recordedWorktreePath,
        branchRef: "refs/heads/feature",
      }),
    ).toEqual({ state: "pending", blockingReason: "worktree_path_unsafe" });
    expect(existsSync(actualWorktree)).toBe(true);
    expect(existsSync(siblingRoot)).toBe(true);
  });

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
  const repository = createTestWorkspace();
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
  runTestProcessOrThrow("git", args, { cwd });
