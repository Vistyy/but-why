import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, rmdirSync } from "node:fs";
import { basename, dirname } from "node:path";

import type { RemoteChangeBranch } from "./change.js";
import { branchNameForRef, changeBranchNameForRef } from "./changeBranch.js";
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
        | "remote_branch_deletion_failed";
    };

export const cleanupChangeResourcesWithRemote =
  (remote: ChangeCleanupRemote) =>
  (input: Parameters<typeof cleanupChangeResources>[0]): ChangeCleanupResult =>
    cleanupChangeResources(input, remote);

type ChangeCleanupInput = {
  readonly repositoryCommonDirectory: string;
  readonly worktreePath: string | null;
  readonly branchRef: string;
  readonly remoteChangeBranch: RemoteChangeBranch | null;
  readonly discardWork?: boolean;
};

type CleanupStage = (
  input: ChangeCleanupInput,
  remote: ChangeCleanupRemote,
) => ChangeCleanupResult | undefined;

export const cleanupChangeResources = (
  input: ChangeCleanupInput,
  remote: ChangeCleanupRemote = localChangeCleanupRemote,
): ChangeCleanupResult => {
  const orderedStages: readonly CleanupStage[] = [
    verifyWorktreePath,
    inspectDirtyWorktree,
    removeManagedWorktree,
    removeWorktreeContainers,
    cleanupLocalBranch,
    cleanupRemoteChangeBranch,
  ];
  for (const stage of orderedStages) {
    const result = stage(input, remote);
    if (result !== undefined) return result;
  }
  return { state: "complete" };
};

const verifyWorktreePath: CleanupStage = (input) =>
  input.worktreePath !== null && !isWorktreePathSafe(input.worktreePath)
    ? { state: "pending", blockingReason: "worktree_path_unsafe" }
    : undefined;

const inspectDirtyWorktree: CleanupStage = (input) => {
  if (
    input.worktreePath === null ||
    !existsSync(input.worktreePath) ||
    input.discardWork === true
  ) {
    return undefined;
  }
  const status = gitAtWorktree(input.worktreePath, [
    "status",
    "--porcelain=v1",
    "--untracked-files=normal",
  ]);
  if (!status.ok) return { state: "pending", blockingReason: "worktree_status_unavailable" };
  return status.stdout.trim().length > 0
    ? { state: "pending", blockingReason: "worktree_has_uncommitted_changes" }
    : undefined;
};

const removeManagedWorktree: CleanupStage = (input) => {
  const worktreePath = input.worktreePath;
  if (worktreePath === null) return undefined;
  if (!isWorktreePathSafe(worktreePath)) {
    return { state: "pending", blockingReason: "worktree_path_unsafe" };
  }

  const registration = git(input.repositoryCommonDirectory, ["worktree", "list", "--porcelain"]);
  if (!registration.ok) return { state: "pending", blockingReason: "worktree_removal_failed" };
  const registered = registration.stdout
    .split("\n")
    .some((line) => line === `worktree ${worktreePath}`);
  const worktreeRemoval = git(input.repositoryCommonDirectory, [
    "worktree",
    "remove",
    ...(input.discardWork === true ? ["--force"] : []),
    "--",
    worktreePath,
  ]);
  if (registered && !worktreeRemoval.ok) {
    return { state: "pending", blockingReason: "worktree_removal_failed" };
  }

  const afterRemoval = git(input.repositoryCommonDirectory, ["worktree", "list", "--porcelain"]);
  return !afterRemoval.ok ||
    existsSync(worktreePath) ||
    afterRemoval.stdout.split("\n").some((line) => line === `worktree ${worktreePath}`)
    ? { state: "pending", blockingReason: "worktree_removal_failed" }
    : undefined;
};

const removeWorktreeContainers: CleanupStage = (input) => {
  if (input.worktreePath === null) return undefined;
  if (!isWorktreePathSafe(input.worktreePath)) {
    return { state: "pending", blockingReason: "worktree_path_unsafe" };
  }
  return removeEmptySiblingContainers(input.worktreePath)
    ? undefined
    : { state: "pending", blockingReason: "worktree_container_removal_failed" };
};

const cleanupLocalBranch: CleanupStage = (input) => {
  if (branchNameForRef(input.branchRef) === undefined) {
    return { state: "pending", blockingReason: "branch_ref_invalid" };
  }
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
    return branchRef.ok || branchRef.status !== 1
      ? { state: "pending", blockingReason: "branch_reachability_unavailable" }
      : undefined;
  }

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
  if (!reachableElsewhere && input.discardWork !== true) {
    return { state: "pending", blockingReason: "branch_not_reachable_from_another_ref" };
  }
  return git(input.repositoryCommonDirectory, [
    "update-ref",
    "--no-deref",
    "-d",
    input.branchRef,
    branchHead.stdout.trim(),
  ]).ok
    ? undefined
    : { state: "pending", blockingReason: "branch_deletion_failed" };
};

const cleanupRemoteChangeBranch = (
  input: Parameters<typeof cleanupChangeResources>[0],
  remote: ChangeCleanupRemote,
): ChangeCleanupResult => {
  const branch = input.remoteChangeBranch;
  if (branch === null) return { state: "complete" };
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
  if (observed.headSha !== branch.expectedHeadSha && input.discardWork !== true) {
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
    expectedHeadSha: observed.headSha,
    resolvedRemoteUrl: observed.remoteUrl,
    ...(observed.repositoryId === undefined ? {} : { repositoryId: observed.repositoryId }),
    ...(observed.refId === undefined ? {} : { refId: observed.refId }),
  });
  return remoteDeletionResult(deletion, observed.headSha);
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
