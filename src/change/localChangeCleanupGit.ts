import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, rmdirSync, rmSync } from "node:fs";
import { basename, dirname } from "node:path";

import type { RemoteChangeBranch } from "./change.js";
import { changeBranchNameForRef, branchNameForRef } from "./changeBranch.js";
import type { ChangeCleanupRemote, RemoteBranchDeletionResult } from "./changeCleanupRemote.js";
export type { ChangeCleanupRemote } from "./changeCleanupRemote.js";

export type ChangeCleanupResult =
  | { readonly state: "complete" }
  | {
      readonly state: "pending";
      readonly blockingReason:
        | "worktree_has_uncommitted_changes"
        | "worktree_status_unavailable"
        | "worktree_removal_failed"
        | "worktree_path_unsafe"
        | "worktree_container_removal_failed"
        | "branch_ref_invalid"
        | "branch_reachability_unavailable"
        | "branch_not_reachable_from_another_ref"
        | "branch_deletion_failed"
        | "remote_branch_unavailable"
        | "remote_branch_repository_mismatch"
        | "remote_branch_ownership_mismatch"
        | "remote_branch_exclusion_unavailable"
        | "remote_branch_excluded"
        | "remote_branch_head_mismatch"
        | "remote_branch_deletion_failed"
        | "reviewer_session_removal_failed";
    };

export const cleanupChangeResourcesWithRemote =
  (remote: ChangeCleanupRemote) =>
  (input: Parameters<typeof cleanupChangeResources>[0]): ChangeCleanupResult =>
    cleanupChangeResources(input, remote);

export const cleanupChangeResources = (
  input: {
    readonly repositoryCommonDirectory: string;
    readonly worktreePath: string | null;
    readonly branchRef: string;
    readonly remoteChangeBranch?: RemoteChangeBranch;
    readonly reviewerSessionPath?: string;
  },
  remote: ChangeCleanupRemote = localChangeCleanupRemote,
): ChangeCleanupResult => {
  if (input.worktreePath !== null && !isWorktreePathSafe(input.worktreePath)) {
    return { state: "pending", blockingReason: "worktree_path_unsafe" };
  }
  if (input.worktreePath !== null) {
    if (existsSync(input.worktreePath)) {
      const status = gitAtWorktree(input.worktreePath, [
        "status",
        "--porcelain=v1",
        "--untracked-files=normal",
      ]);
      if (!status.ok) return { state: "pending", blockingReason: "worktree_status_unavailable" };
      if (status.stdout.trim().length > 0) {
        return { state: "pending", blockingReason: "worktree_has_uncommitted_changes" };
      }
    }

    const registration = git(input.repositoryCommonDirectory, ["worktree", "list", "--porcelain"]);
    if (!registration.ok) {
      return { state: "pending", blockingReason: "worktree_removal_failed" };
    }
    const registered = registration.stdout
      .split("\n")
      .some((line) => line === `worktree ${input.worktreePath}`);
    if (
      registered &&
      !git(input.repositoryCommonDirectory, ["worktree", "remove", "--", input.worktreePath]).ok
    ) {
      return { state: "pending", blockingReason: "worktree_removal_failed" };
    }

    const afterRemoval = git(input.repositoryCommonDirectory, ["worktree", "list", "--porcelain"]);
    if (
      !afterRemoval.ok ||
      existsSync(input.worktreePath) ||
      afterRemoval.stdout.split("\n").some((line) => line === `worktree ${input.worktreePath}`)
    ) {
      return { state: "pending", blockingReason: "worktree_removal_failed" };
    }
  }

  if (input.worktreePath !== null && !removeEmptySiblingContainers(input.worktreePath)) {
    return { state: "pending", blockingReason: "worktree_container_removal_failed" };
  }

  if (
    input.reviewerSessionPath !== undefined &&
    !removeReviewerSession(input.reviewerSessionPath)
  ) {
    return { state: "pending", blockingReason: "reviewer_session_removal_failed" };
  }

  const branchName = branchNameForRef(input.branchRef);
  if (branchName === undefined) return { state: "pending", blockingReason: "branch_ref_invalid" };
  const branchHead = git(input.repositoryCommonDirectory, [
    "rev-parse",
    "--verify",
    `${input.branchRef}^{commit}`,
  ]);
  if (!branchHead.ok) {
    const branchRef = git(input.repositoryCommonDirectory, [
      "show-ref",
      "--verify",
      "--quiet",
      input.branchRef,
    ]);
    if (branchRef.ok || branchRef.status !== 1) {
      return { state: "pending", blockingReason: "branch_reachability_unavailable" };
    }
  } else {
    const containingRefs = git(input.repositoryCommonDirectory, [
      "for-each-ref",
      "--contains",
      branchHead.stdout.trim(),
      "--format=%(refname)",
    ]);
    if (!containingRefs.ok) {
      return { state: "pending", blockingReason: "branch_reachability_unavailable" };
    }
    const reachableElsewhere = containingRefs.stdout
      .split("\n")
      .some((ref) => ref.length > 0 && ref !== input.branchRef);
    if (!reachableElsewhere) {
      return { state: "pending", blockingReason: "branch_not_reachable_from_another_ref" };
    }
    if (!git(input.repositoryCommonDirectory, ["branch", "-D", "--", branchName]).ok) {
      return { state: "pending", blockingReason: "branch_deletion_failed" };
    }
  }
  return cleanupRemoteChangeBranch(input, remote);
};

const cleanupRemoteChangeBranch = (
  input: Parameters<typeof cleanupChangeResources>[0],
  remote: ChangeCleanupRemote,
): ChangeCleanupResult => {
  const branch = input.remoteChangeBranch;
  if (branch === undefined) return { state: "complete" };
  const canonicalBranchName = changeBranchNameForRef(input.branchRef);
  if (canonicalBranchName === undefined || canonicalBranchName !== branch.branchName) {
    return { state: "pending", blockingReason: "remote_branch_ownership_mismatch" };
  }
  if (branch.targetBranch.trim().length === 0) {
    return { state: "pending", blockingReason: "remote_branch_exclusion_unavailable" };
  }
  if (canonicalBranchName === branch.targetBranch) {
    return { state: "pending", blockingReason: "remote_branch_excluded" };
  }
  const observed = remote.readRemoteBranchHead({
    repositoryCommonDirectory: input.repositoryCommonDirectory,
    owner: branch.owner,
    repo: branch.repo,
    remoteName: branch.remoteName,
    remoteUrl: branch.remoteUrl,
    branchName: branch.branchName,
    canonicalBranchRef: input.branchRef,
    targetBranch: branch.targetBranch,
  });
  if (observed.state === "missing") return { state: "complete" };
  if (observed.state === "unavailable") {
    return { state: "pending", blockingReason: "remote_branch_unavailable" };
  }
  if (observed.state === "mismatch") {
    return { state: "pending", blockingReason: "remote_branch_repository_mismatch" };
  }
  if (observed.state === "excluded") {
    return { state: "pending", blockingReason: "remote_branch_excluded" };
  }
  if (observed.headSha !== branch.expectedHeadSha) {
    return { state: "pending", blockingReason: "remote_branch_head_mismatch" };
  }
  const deletion = remote.deleteRemoteBranch({
    repositoryCommonDirectory: input.repositoryCommonDirectory,
    owner: branch.owner,
    repo: branch.repo,
    remoteName: branch.remoteName,
    remoteUrl: branch.remoteUrl,
    branchName: branch.branchName,
    targetBranch: branch.targetBranch,
    canonicalBranchRef: input.branchRef,
    expectedHeadSha: branch.expectedHeadSha,
    resolvedRemoteUrl: observed.remoteUrl,
    ...(observed.repositoryId === undefined ? {} : { repositoryId: observed.repositoryId }),
    ...(observed.refId === undefined ? {} : { refId: observed.refId }),
  });
  return remoteDeletionResult(deletion, branch.expectedHeadSha);
};

const remoteDeletionResult = (
  result: RemoteBranchDeletionResult,
  expectedHeadSha: string,
): ChangeCleanupResult => {
  if (result.state === "deleted" || result.state === "missing") return { state: "complete" };
  if (result.state === "unavailable") {
    return { state: "pending", blockingReason: "remote_branch_unavailable" };
  }
  if (result.state === "mismatch") {
    return { state: "pending", blockingReason: "remote_branch_repository_mismatch" };
  }
  if (result.state === "excluded") {
    return { state: "pending", blockingReason: "remote_branch_excluded" };
  }
  if (result.state === "present" && result.headSha !== expectedHeadSha) {
    return { state: "pending", blockingReason: "remote_branch_head_mismatch" };
  }
  return { state: "pending", blockingReason: "remote_branch_deletion_failed" };
};

const localChangeCleanupRemote: ChangeCleanupRemote = {
  readRemoteBranchHead: () => ({ state: "unavailable" }),
  deleteRemoteBranch: () => ({ state: "failed" }),
};

const isWorktreePathSafe = (worktreePath: string): boolean => {
  const paths = [dirname(dirname(worktreePath)), dirname(worktreePath), worktreePath];
  return paths.every((path) => {
    try {
      if (!existsSync(path)) return true;
      const entry = lstatSync(path);
      return entry.isDirectory() && !entry.isSymbolicLink();
    } catch {
      return false;
    }
  });
};

const removeEmptySiblingContainers = (worktreePath: string): boolean => {
  const butWhyContainer = dirname(worktreePath);
  const siblingRoot = dirname(butWhyContainer);
  if (basename(butWhyContainer) !== "but-why" || !basename(siblingRoot).endsWith("-worktrees")) {
    return true;
  }
  try {
    rmdirSync(butWhyContainer);
  } catch (error) {
    if (isFileSystemError(error, "ENOTEMPTY")) return true;
    if (!isFileSystemError(error, "ENOENT")) return false;
  }
  try {
    rmdirSync(siblingRoot);
    return true;
  } catch (error) {
    return isFileSystemError(error, "ENOTEMPTY") || isFileSystemError(error, "ENOENT");
  }
};

const removeReviewerSession = (path: string): boolean => {
  try {
    if (!existsSync(path)) return true;
    rmSync(path, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
};

const isFileSystemError = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code;

type GitResult =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly status: number | null };

const git = (commonDirectory: string, args: readonly string[]): GitResult =>
  runGit([`--git-dir=${commonDirectory}`, ...args], commonDirectory);

const gitAtWorktree = (worktreePath: string, args: readonly string[]): GitResult =>
  runGit(["-C", worktreePath, ...args], worktreePath);

const runGit = (args: readonly string[], cwd: string): GitResult => runGitCommand(args, cwd);

const runGitCommand = (args: readonly string[], cwd: string): GitResult => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0
    ? { ok: true, stdout: result.stdout }
    : { ok: false, status: result.status };
};
