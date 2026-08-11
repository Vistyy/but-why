import { chmodSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { cleanupChangeResources } from "../../src/change/adapters/localChangeCleanupGit.js";
import { runTestProcessOrThrow } from "../support/testProcess.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

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
        remoteChangeBranch: null,
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
        remoteChangeBranch: null,
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
        remoteChangeBranch: null,
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
        remoteChangeBranch: null,
      }),
    ).toEqual({ state: "complete" });
    expect(existsSync(worktreePath)).toBe(false);
    expect(existsSync(sharedStatePath)).toBe(true);
  });

  it("retains the Change-owned Reviewer Session storage during cleanup", () => {
    const repository = initializedRepository();
    const commonDirectory = git(
      repository,
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    );
    const worktreePath = join(commonDirectory, "but-why", "worktrees", "feature");
    const reviewerSessionPath = join(commonDirectory, "but-why", "change-1");
    git(repository, "worktree", "add", "-b", "feature", worktreePath, "main");
    mkdirSync(join(reviewerSessionPath, "acceptance", "reviewer-sessions"), {
      recursive: true,
    });
    writeFileSync(
      join(reviewerSessionPath, "acceptance", "reviewer-sessions", "review_session.jsonl"),
      '{"type":"session"}\n',
    );

    expect(
      cleanupChangeResources({
        repositoryCommonDirectory: commonDirectory,
        worktreePath,
        branchRef: "refs/heads/feature",
        remoteChangeBranch: null,
      }),
    ).toEqual({ state: "complete" });
    expect(existsSync(reviewerSessionPath)).toBe(true);
    expect(existsSync(join(reviewerSessionPath, "acceptance", "reviewer-sessions"))).toBe(true);
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
        remoteChangeBranch: null,
      }),
    ).toEqual({ state: "pending", blockingReason: "worktree_path_unsafe" });
    expect(existsSync(actualWorktree)).toBe(true);
    expect(existsSync(siblingRoot)).toBe(true);
  });

  it("reverifies container path safety after Managed Worktree removal", () => {
    const repository = initializedRepository();
    const commonDirectory = git(
      repository,
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    );
    const siblingRoot = join(dirname(repository), `${basename(repository)}-worktrees`);
    const worktreePath = join(siblingRoot, "but-why", "feature");
    git(repository, "worktree", "add", "-b", "feature", worktreePath, "main");
    const branchHead = git(repository, "rev-parse", "refs/heads/feature");
    const externalTarget = createTestWorkspace();
    const externalContainer = join(externalTarget, "but-why");
    mkdirSync(externalContainer);
    const realGit = runTestProcessOrThrow("sh", ["-c", "command -v git"], { cwd: repository });
    const commandDirectory = createTestWorkspace();
    const gitWrapper = join(commandDirectory, "git");
    writeFileSync(
      gitWrapper,
      `#!/usr/bin/env node
import { rmSync, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
const result = spawnSync(${JSON.stringify(realGit)}, args, { stdio: "inherit" });
if (result.status === 0 && args.includes("worktree") && args.includes("remove")) {
  rmSync(${JSON.stringify(siblingRoot)}, { recursive: true, force: true });
  symlinkSync(${JSON.stringify(externalTarget)}, ${JSON.stringify(siblingRoot)}, "dir");
}
process.exit(result.status ?? 1);
`,
    );
    chmodSync(gitWrapper, 0o755);
    const previousPath = process.env["PATH"];

    let result: ReturnType<typeof cleanupChangeResources>;
    try {
      process.env["PATH"] = `${commandDirectory}:${previousPath ?? ""}`;
      result = cleanupChangeResources({
        repositoryCommonDirectory: commonDirectory,
        worktreePath,
        branchRef: "refs/heads/feature",
        remoteChangeBranch: null,
      });
    } finally {
      process.env["PATH"] = previousPath;
    }

    expect(result).toEqual({ state: "pending", blockingReason: "worktree_path_unsafe" });
    expect(existsSync(externalContainer)).toBe(true);
    expect(git(repository, "rev-parse", "refs/heads/feature")).toBe(branchHead);
  });

  it("suppresses later mutations after dirty-work inspection blocks cleanup", () => {
    const repository = initializedRepository();
    const worktreePath = join(repository, "feature-worktree");
    git(repository, "worktree", "add", "-b", "but-why/feature", worktreePath, "main");
    writeFileSync(join(worktreePath, "uncommitted.txt"), "preserve this work\n");
    const remoteCalls: string[] = [];

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
            expectedHeadSha: "candidate-head",
          },
        },
        {
          readRemoteBranchHead: () => {
            remoteCalls.push("read");
            return { state: "missing" };
          },
          deleteRemoteBranch: () => {
            remoteCalls.push("delete");
            return { state: "deleted" };
          },
        },
      ),
    ).toEqual({
      state: "pending",
      blockingReason: "worktree_has_uncommitted_changes",
    });
    expect(existsSync(worktreePath)).toBe(true);
    expect(git(repository, "rev-parse", "refs/heads/but-why/feature")).not.toBe("");
    expect(remoteCalls).toEqual([]);
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
        remoteChangeBranch: null,
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
        remoteChangeBranch: null,
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
        remoteChangeBranch: null,
      }),
    ).toEqual({ state: "complete" });
    expect(existsSync(worktreePath)).toBe(false);
    expect(git(repository, "branch", "--list", "feature")).toBe("");
  });

  it("deletes a symbolic local Repository Branch without dereferencing its target", () => {
    const repository = initializedRepository();
    const commonDirectory = git(
      repository,
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    );
    const mainHead = git(repository, "rev-parse", "refs/heads/main");
    git(repository, "symbolic-ref", "refs/heads/feature", "refs/heads/main");

    expect(
      cleanupChangeResources({
        repositoryCommonDirectory: commonDirectory,
        worktreePath: null,
        branchRef: "refs/heads/feature",
        remoteChangeBranch: null,
      }),
    ).toEqual({ state: "complete" });
    expect(git(repository, "rev-parse", "refs/heads/main")).toBe(mainHead);
    expect(existsSync(join(commonDirectory, "refs", "heads", "feature"))).toBe(false);
  });

  it("preserves a local Repository Branch that moves after reachability verification", () => {
    const repository = initializedRepository();
    const commonDirectory = git(
      repository,
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    );
    const worktreePath = join(repository, "feature-worktree");
    git(repository, "worktree", "add", "-b", "feature", worktreePath, "main");
    const movedHead = git(
      repository,
      "commit-tree",
      "HEAD^{tree}",
      "-p",
      "HEAD",
      "-m",
      "Moved branch head",
    );
    const realGit = runTestProcessOrThrow("sh", ["-c", "command -v git"], { cwd: repository });
    const commandDirectory = createTestWorkspace();
    const gitWrapper = join(commandDirectory, "git");
    writeFileSync(
      gitWrapper,
      `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
const deletesBranch =
  (args.includes("branch") && args.includes("-D")) ||
  (args.includes("update-ref") && args.includes("-d") && args.includes("refs/heads/feature"));
if (deletesBranch) {
  spawnSync(${JSON.stringify(realGit)}, [${JSON.stringify(`--git-dir=${commonDirectory}`)}, "update-ref", "refs/heads/feature", ${JSON.stringify(movedHead)}]);
}
const result = spawnSync(${JSON.stringify(realGit)}, args, { stdio: "inherit" });
process.exit(result.status ?? 1);
`,
    );
    chmodSync(gitWrapper, 0o755);
    const previousPath = process.env["PATH"];

    let result: ReturnType<typeof cleanupChangeResources>;
    try {
      process.env["PATH"] = `${commandDirectory}:${previousPath ?? ""}`;
      result = cleanupChangeResources({
        repositoryCommonDirectory: commonDirectory,
        worktreePath,
        branchRef: "refs/heads/feature",
        remoteChangeBranch: null,
      });
    } finally {
      process.env["PATH"] = previousPath;
    }

    expect(result).toEqual({ state: "pending", blockingReason: "branch_deletion_failed" });
    expect(git(repository, "rev-parse", "refs/heads/feature")).toBe(movedHead);
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
        remoteChangeBranch: null,
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
        pathToFileURL(
          join(import.meta.dirname, "../../src/change/adapters/localChangeCleanupGit.ts"),
        ).href,
      )});
const [repositoryCommonDirectory, worktreePath, branchRef] = process.argv.slice(2);
console.log(JSON.stringify(cleanupChangeResources({ repositoryCommonDirectory, worktreePath, branchRef, remoteChangeBranch: null })));
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

  it("finishes ordered local mutation stages before Remote Change Branch cleanup", () => {
    const repository = initializedRepository();
    const siblingRoot = join(dirname(repository), `${basename(repository)}-worktrees`);
    const butWhyContainer = join(siblingRoot, "but-why");
    const worktreePath = join(butWhyContainer, "feature");
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
            expect(existsSync(worktreePath)).toBe(false);
            expect(existsSync(butWhyContainer)).toBe(false);
            expect(existsSync(siblingRoot)).toBe(false);
            expect(git(repository, "branch", "--list", "but-why/feature")).toBe("");
            return {
              state: "present",
              headSha: expectedHeadSha,
              remoteUrl: "origin-url",
            };
          },
          deleteRemoteBranch: () => {
            calls.push("delete");
            return { state: "deleted" };
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
          discardWork: true,
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

  it("keeps cleanup pending when the Remote Change Branch remains present", () => {
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
          deleteRemoteBranch: () => ({
            state: "present",
            headSha: "candidate-head",
            remoteUrl: "origin-url",
          }),
        },
      ),
    ).toEqual({ state: "pending", blockingReason: "remote_branch_deletion_failed" });
    expect(reads).toBe(1);
  });

  it("classifies missing and unavailable Remote Change Branch deletion results", () => {
    const repository = initializedRepository();
    const cases = [
      {
        name: "missing after deletion race",
        deletion: { state: "missing" as const },
        expected: { state: "complete" as const },
      },
      {
        name: "unavailable during deletion",
        deletion: { state: "unavailable" as const },
        expected: {
          state: "pending" as const,
          blockingReason: "remote_branch_unavailable" as const,
        },
      },
    ];

    for (const scenario of cases) {
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
            readRemoteBranchHead: () => ({
              state: "present",
              headSha: "candidate-head",
              remoteUrl: "origin-url",
            }),
            deleteRemoteBranch: () => scenario.deletion,
          },
        ),
        scenario.name,
      ).toEqual(scenario.expected);
    }
  });

  it("keeps discard pending when the Remote Change Branch is excluded", () => {
    const repository = initializedRepository();
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
          worktreePath: null,
          branchRef: "refs/heads/but-why/feature",
          discardWork: true,
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
          readRemoteBranchHead: () => ({ state: "excluded" }),
          deleteRemoteBranch: () => {
            deleted = true;
            return { state: "deleted" };
          },
        },
      ),
    ).toEqual({ state: "pending", blockingReason: "remote_branch_excluded" });
    expect(deleted).toBe(false);
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
          discardWork: true,
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
            return { state: "deleted" };
          },
        },
      ),
    ).toEqual({ state: "pending", blockingReason: "remote_branch_head_mismatch" });
    expect(deleted).toBe(false);
  });

  it("discards a dirty Managed Worktree and its unique branch for one attempt", () => {
    const repository = initializedRepository();
    const worktreePath = join(repository, "feature-worktree");
    git(repository, "worktree", "add", "-b", "but-why/feature", worktreePath, "main");
    writeFileSync(join(worktreePath, "feature.txt"), "unmerged work\n");
    git(worktreePath, "add", "feature.txt");
    git(worktreePath, "commit", "-m", "Feature");
    writeFileSync(join(worktreePath, "dirty.txt"), "uncommitted work\n");

    expect(
      cleanupChangeResources({
        repositoryCommonDirectory: git(
          repository,
          "rev-parse",
          "--path-format=absolute",
          "--git-common-dir",
        ),
        worktreePath,
        branchRef: "refs/heads/but-why/feature",
        remoteChangeBranch: null,
        discardWork: true,
      }),
    ).toEqual({ state: "complete" });
    expect(existsSync(worktreePath)).toBe(false);
    expect(git(repository, "branch", "--list", "but-why/feature")).toBe("");
  });

  it("deletes a changed Remote Change Branch at the exact observed head for a discard attempt", () => {
    const repository = initializedRepository();
    let deletedHead: string | undefined;

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
          discardWork: true,
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
          readRemoteBranchHead: () => ({
            state: "present",
            headSha: "moved-head",
            remoteUrl: "origin-url",
          }),
          deleteRemoteBranch: (input) => {
            deletedHead = input.expectedHeadSha;
            return { state: "deleted" };
          },
        },
      ),
    ).toEqual({ state: "complete" });
    expect(deletedHead).toBe("moved-head");
  });

  it("keeps a changed Remote Change Branch pending when it changed after read during discard", () => {
    const repository = initializedRepository();
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
          worktreePath: null,
          branchRef: "refs/heads/but-why/feature",
          discardWork: true,
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
          readRemoteBranchHead: () => ({
            state: "present",
            headSha: "moved-head",
            remoteUrl: "origin-url",
          }),
          deleteRemoteBranch: () => {
            deleted = true;
            return {
              state: "present",
              headSha: "changed-after-read",
              remoteUrl: "origin-url",
            };
          },
        },
      ),
    ).toEqual({ state: "pending", blockingReason: "remote_branch_head_mismatch" });
    expect(deleted).toBe(true);
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
