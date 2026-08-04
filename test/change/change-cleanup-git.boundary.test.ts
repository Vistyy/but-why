import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
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

  it("keeps cleanup pending when local Repository Branch verification fails", () => {
    const repository = initializedRepository();
    const commonDirectory = git(
      repository,
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    );
    const branchPath = join(commonDirectory, "refs", "heads", "feature");
    mkdirSync(dirname(branchPath), { recursive: true });
    writeFileSync(branchPath, `${"1".repeat(40)}\n`);

    expect(
      cleanupChangeResources({
        repositoryCommonDirectory: commonDirectory,
        worktreePath: null,
        branchRef: "refs/heads/feature",
      }),
    ).toEqual({ state: "pending", blockingReason: "branch_reachability_unavailable" });
    expect(existsSync(branchPath)).toBe(true);
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

  it("removes a stale Managed Worktree registration when its path is absent", () => {
    const repository = initializedRepository();
    const commonDirectory = git(
      repository,
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    );
    const worktreePath = join(repository, "feature-worktree");
    git(repository, "worktree", "add", "-b", "feature", worktreePath, "main");
    rmSync(worktreePath, { recursive: true, force: true });
    git(repository, "update-ref", "-d", "refs/heads/feature");

    expect(
      cleanupChangeResources({
        repositoryCommonDirectory: commonDirectory,
        worktreePath,
        branchRef: "refs/heads/feature",
      }),
    ).toEqual({ state: "complete" });
    expect(git(repository, "worktree", "list", "--porcelain")).not.toContain(worktreePath);
  });

  it("deletes the local Repository Branch when cleanup runs inside its Managed Worktree", () => {
    const repository = initializedRepository();
    const commonDirectory = git(
      repository,
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    );
    const worktreePath = join(repository, "feature-worktree");
    git(repository, "worktree", "add", "-b", "feature", worktreePath, "main");
    writeFileSync(join(worktreePath, "feature.txt"), "merged work\\n");
    git(worktreePath, "add", "feature.txt");
    git(worktreePath, "commit", "-m", "Feature");
    git(repository, "merge", "--ff-only", "feature");

    const script = createTestWorkspace();
    const cleanupScript = join(script, "cleanup.mjs");
    writeFileSync(
      cleanupScript,
      `const { cleanupChangeResources } = await import(${JSON.stringify(
        pathToFileURL(join(import.meta.dirname, "../../src/change/localChangeCleanupGit.ts")).href,
      )});
const [repositoryCommonDirectory, worktreePath, branchRef] = process.argv.slice(2);
console.log(JSON.stringify(cleanupChangeResources({ repositoryCommonDirectory, worktreePath, branchRef })));
`,
    );

    expect(
      runTestProcessOrThrow(
        process.execPath,
        [
          "--import",
          join(import.meta.dirname, "../../node_modules/tsx/dist/loader.mjs"),
          cleanupScript,
          commonDirectory,
          worktreePath,
          "refs/heads/feature",
        ],
        { cwd: worktreePath },
      ),
    ).toBe(JSON.stringify({ state: "complete" }));
    expect(existsSync(worktreePath)).toBe(false);
    expect(git(repository, "worktree", "list", "--porcelain")).not.toContain(worktreePath);
    expect(git(repository, "branch", "--list", "feature")).toBe("");
  });

  it("deletes an exact Remote Change Branch after local cleanup", () => {
    const repository = initializedRepository();
    const worktreePath = join(repository, "feature-worktree");
    git(repository, "worktree", "add", "-b", "but-why/feature", worktreePath, "main");
    writeFileSync(join(worktreePath, "feature.txt"), "merged work\n");
    git(worktreePath, "add", "feature.txt");
    git(worktreePath, "commit", "-m", "Feature");
    const expectedHeadSha = git(worktreePath, "rev-parse", "HEAD");
    git(repository, "merge", "--ff-only", "but-why/feature");
    const calls: string[] = [];

    expect(
      cleanupChangeResources(
        {
          repositoryCommonDirectory: git(
            repository,
            "rev-parse",
            "--path-format=absolute",
            "--git-common-dir",
          ),
          worktreePath,
          branchRef: "refs/heads/but-why/feature",
          remoteChangeBranch: {
            owner: "acme",
            repo: "widgets",
            remoteName: "origin",
            remoteUrl: "origin-url",
            branchName: "but-why/feature",
            targetBranch: "main",
            expectedHeadSha,
          },
        },
        {
          readRemoteBranchHead: () => {
            calls.push("read");
            return {
              state: "present",
              headSha: expectedHeadSha,
              remoteUrl: "origin-url",
            };
          },
          deleteRemoteBranch: () => {
            calls.push("delete");
            return true;
          },
        },
      ),
    ).toEqual({ state: "complete" });
    expect(calls).toEqual(["read", "delete"]);
  });

  it("treats an already absent Remote Change Branch as complete", () => {
    const repository = initializedRepository();

    expect(
      cleanupChangeResources(
        {
          repositoryCommonDirectory: git(
            repository,
            "rev-parse",
            "--path-format=absolute",
            "--git-common-dir",
          ),
          worktreePath: null,
          branchRef: "refs/heads/but-why/feature",
          remoteChangeBranch: {
            owner: "acme",
            repo: "widgets",
            remoteName: "origin",
            remoteUrl: "origin-url",
            branchName: "but-why/feature",
            targetBranch: "main",
            expectedHeadSha: "candidate-head",
          },
        },
        {
          readRemoteBranchHead: () => ({ state: "missing" }),
          deleteRemoteBranch: () => {
            throw new Error("An absent branch must not be deleted");
          },
        },
      ),
    ).toEqual({ state: "complete" });
  });

  it("keeps cleanup pending when the Remote Change Branch target is unavailable", () => {
    const repository = initializedRepository();

    expect(
      cleanupChangeResources(
        {
          repositoryCommonDirectory: git(
            repository,
            "rev-parse",
            "--path-format=absolute",
            "--git-common-dir",
          ),
          worktreePath: null,
          branchRef: "refs/heads/but-why/feature",
          remoteChangeBranch: {
            owner: "acme",
            repo: "widgets",
            remoteName: "origin",
            remoteUrl: "origin-url",
            branchName: "but-why/feature",
            targetBranch: "",
            expectedHeadSha: "candidate-head",
          },
        },
        {
          readRemoteBranchHead: () => {
            throw new Error("An unavailable target must not be read");
          },
          deleteRemoteBranch: () => {
            throw new Error("An unavailable target must not be deleted");
          },
        },
      ),
    ).toEqual({ state: "pending", blockingReason: "remote_branch_exclusion_unavailable" });
  });

  it("keeps cleanup pending when the Remote Change Branch cannot be read", () => {
    const repository = initializedRepository();

    expect(
      cleanupChangeResources(
        {
          repositoryCommonDirectory: git(
            repository,
            "rev-parse",
            "--path-format=absolute",
            "--git-common-dir",
          ),
          worktreePath: null,
          branchRef: "refs/heads/but-why/feature",
          remoteChangeBranch: {
            owner: "acme",
            repo: "widgets",
            remoteName: "origin",
            remoteUrl: "origin-url",
            branchName: "but-why/feature",
            targetBranch: "main",
            expectedHeadSha: "candidate-head",
          },
        },
        {
          readRemoteBranchHead: () => ({ state: "unavailable" }),
          deleteRemoteBranch: () => {
            throw new Error("An unreadable branch must not be deleted");
          },
        },
      ),
    ).toEqual({ state: "pending", blockingReason: "remote_branch_unavailable" });
  });

  it("reports a Remote Change Branch deletion failure for retry", () => {
    const repository = initializedRepository();
    let reads = 0;

    expect(
      cleanupChangeResources(
        {
          repositoryCommonDirectory: git(
            repository,
            "rev-parse",
            "--path-format=absolute",
            "--git-common-dir",
          ),
          worktreePath: null,
          branchRef: "refs/heads/but-why/feature",
          remoteChangeBranch: {
            owner: "acme",
            repo: "widgets",
            remoteName: "origin",
            remoteUrl: "origin-url",
            branchName: "but-why/feature",
            targetBranch: "main",
            expectedHeadSha: "candidate-head",
          },
        },
        {
          readRemoteBranchHead: () => {
            reads += 1;
            return {
              state: "present",
              headSha: "candidate-head",
              remoteUrl: "origin-url",
            };
          },
          deleteRemoteBranch: () => false,
        },
      ),
    ).toEqual({ state: "pending", blockingReason: "remote_branch_deletion_failed" });
    expect(reads).toBe(1);
  });

  it("preserves a Remote Change Branch from a repointed remote", () => {
    const repository = initializedRepository();

    expect(
      cleanupChangeResources(
        {
          repositoryCommonDirectory: git(
            repository,
            "rev-parse",
            "--path-format=absolute",
            "--git-common-dir",
          ),
          worktreePath: null,
          branchRef: "refs/heads/but-why/feature",
          remoteChangeBranch: {
            owner: "acme",
            repo: "widgets",
            remoteName: "origin",
            remoteUrl: "origin-url",
            branchName: "but-why/feature",
            targetBranch: "main",
            expectedHeadSha: "candidate-head",
          },
        },
        {
          readRemoteBranchHead: () => ({ state: "mismatch" }),
          deleteRemoteBranch: () => {
            throw new Error("A repointed remote must not be deleted");
          },
        },
      ),
    ).toEqual({
      state: "pending",
      blockingReason: "remote_branch_repository_mismatch",
    });
  });

  it("preserves a Remote Change Branch that moved to another commit", () => {
    const repository = initializedRepository();
    const worktreePath = join(repository, "feature-worktree");
    git(repository, "worktree", "add", "-b", "but-why/feature", worktreePath, "main");
    writeFileSync(join(worktreePath, "feature.txt"), "merged work\n");
    git(worktreePath, "add", "feature.txt");
    git(worktreePath, "commit", "-m", "Feature");
    const expectedHeadSha = git(worktreePath, "rev-parse", "HEAD");
    git(repository, "merge", "--ff-only", "but-why/feature");
    let deleted = false;

    expect(
      cleanupChangeResources(
        {
          repositoryCommonDirectory: git(
            repository,
            "rev-parse",
            "--path-format=absolute",
            "--git-common-dir",
          ),
          worktreePath,
          branchRef: "refs/heads/but-why/feature",
          remoteChangeBranch: {
            owner: "acme",
            repo: "widgets",
            remoteName: "origin",
            remoteUrl: "origin-url",
            branchName: "but-why/feature",
            targetBranch: "main",
            expectedHeadSha,
          },
        },
        {
          readRemoteBranchHead: () => ({
            state: "present",
            headSha: "another-head",
            remoteUrl: "origin-url",
          }),
          deleteRemoteBranch: () => {
            deleted = true;
            return true;
          },
        },
      ),
    ).toEqual({ state: "pending", blockingReason: "remote_branch_head_mismatch" });
    expect(deleted).toBe(false);
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
