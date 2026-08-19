import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { Effect } from "effect";

import type {
  CandidateCaptureGit,
  LocalCandidateWorkspaceResult,
  RepositoryBranchHeadResult,
} from "../candidateCaptureGit.js";

export const localCandidateCaptureGit: CandidateCaptureGit = {
  readWorkspace: (cwd) => Effect.sync(() => readLocalCandidateWorkspace(cwd)),
  resolveLocalBranch: (cwd, ref) => Effect.sync(() => resolveLocalBranch(cwd, ref)),
  containsCommit: (cwd, ancestorSha, headSha) =>
    Effect.sync(() => containsCommit(cwd, ancestorSha, headSha)),
  trackedTreeMatches: (cwd, commitSha) => Effect.sync(() => trackedTreeMatches(cwd, commitSha)),
  localBranchExists: (cwd, ref) => Effect.sync(() => localBranchExists(cwd, ref)),
  recordedRemoteDefaultLocalBranches: (cwd) =>
    Effect.sync(() => recordedRemoteDefaultLocalBranches(cwd)),
};

const readLocalCandidateWorkspace = (cwd: string): LocalCandidateWorkspaceResult => {
  const commonDirectory = git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir");
  const worktrees = git(cwd, "worktree", "list", "--porcelain");
  if (!commonDirectory.ok || !worktrees.ok) return { ok: false, code: "git_tooling_error" };
  const worktreeEntries = worktrees.stdout.split("\n\n");
  const currentRoot = git(cwd, "rev-parse", "--path-format=absolute", "--show-toplevel");
  if (!currentRoot.ok) return { ok: false, code: "git_tooling_error" };

  const branch = git(cwd, "symbolic-ref", "-q", "HEAD");
  if (!branch.ok) return { ok: false, code: "detached_head" };
  if (!branch.stdout.startsWith("refs/heads/")) {
    return { ok: false, code: "conflicting_branch_facts" };
  }
  const listedBranch = worktreeEntries
    .find((entry) => entry.includes(`worktree ${realpathSync(currentRoot.stdout)}\n`))
    ?.split("\n")
    .find((line) => line.startsWith("branch "))
    ?.slice("branch ".length);
  if (listedBranch !== branch.stdout) return { ok: false, code: "conflicting_branch_facts" };

  const head = git(cwd, "rev-parse", "--verify", "HEAD^{commit}");
  if (!head.ok) return { ok: false, code: "unborn_branch" };
  const status = git(cwd, "status", "--porcelain=v1", "--untracked-files=normal");
  if (!status.ok) return { ok: false, code: "git_tooling_error" };
  if (status.stdout.length > 0) return { ok: false, code: "dirty_work" };

  const renameFromRef = exactRenameSource(cwd, branch.stdout);
  return {
    ok: true,
    facts: {
      repositoryCommonDirectory: realpathSync(commonDirectory.stdout),
      branchRef: branch.stdout,
      headSha: head.stdout,
      ...(renameFromRef === undefined ? {} : { renameFromRef }),
    },
  };
};

export const readRepositoryBranchHead = (
  cwd: string,
  expectedBranchRef: string,
): RepositoryBranchHeadResult => {
  const branch = git(cwd, "symbolic-ref", "-q", "HEAD");
  if (!branch.ok) return { ok: false, code: "detached_head" };
  if (!branch.stdout.startsWith("refs/heads/") || branch.stdout !== expectedBranchRef) {
    return { ok: false, code: "conflicting_branch_facts" };
  }
  const head = git(cwd, "rev-parse", "--verify", "HEAD^{commit}");
  return head.ok ? { ok: true, headSha: head.stdout } : { ok: false, code: "unborn_branch" };
};

const resolveLocalBranch = (cwd: string, ref: string): string | undefined => {
  const result = git(cwd, "rev-parse", "--verify", `${ref}^{commit}`);
  return result.ok ? result.stdout : undefined;
};

const containsCommit = (cwd: string, ancestorSha: string, headSha: string): boolean | undefined => {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestorSha, headSha], {
    cwd,
    encoding: "utf8",
  });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  return undefined;
};

const trackedTreeMatches = (cwd: string, commitSha: string): boolean | undefined => {
  const currentTree = git(cwd, "rev-parse", "HEAD^{tree}");
  const startingTree = git(cwd, "rev-parse", `${commitSha}^{tree}`);
  if (!currentTree.ok || !startingTree.ok) return undefined;
  return currentTree.stdout === startingTree.stdout;
};

const localBranchExists = (cwd: string, ref: string): boolean =>
  (ref.startsWith("refs/heads/") || ref.startsWith("refs/remotes/")) &&
  git(cwd, "show-ref", "--verify", "--quiet", ref).ok;

const recordedRemoteDefaultLocalBranches = (cwd: string): readonly string[] | undefined => {
  const remotes = git(cwd, "remote");
  if (!remotes.ok) return undefined;
  return remotes.stdout
    .split("\n")
    .filter((remote) => remote.length > 0)
    .flatMap((remote) => {
      const prefix = `refs/remotes/${remote}/`;
      const result = git(cwd, "symbolic-ref", `${prefix}HEAD`);
      return result.ok && result.stdout.startsWith(prefix) ? [result.stdout] : [];
    });
};

const exactRenameSource = (cwd: string, destinationRef: string): string | undefined => {
  const result = git(cwd, "reflog", "show", "--format=%gs", destinationRef);
  if (!result.ok) return undefined;
  for (const subject of result.stdout.split("\n")) {
    const match = /^Branch: renamed (refs\/heads\/.+) to (refs\/heads\/.+)$/.exec(subject);
    if (match?.[2] === destinationRef) return match[1];
  }
  return undefined;
};

type GitResult = { readonly ok: true; readonly stdout: string } | { readonly ok: false };

const git = (cwd: string, ...args: readonly string[]): GitResult => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return result.status === 0 ? { ok: true, stdout: result.stdout.trim() } : { ok: false };
};
