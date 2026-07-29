import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, rmdirSync, rmSync } from "node:fs";
import { basename, dirname } from "node:path";

import type { RemoteChangeBranch } from "./change.js";

export type RemoteBranchHeadResult =
  | { readonly state: "missing" }
  | { readonly state: "present"; readonly headSha: string }
  | { readonly state: "unavailable" }
  | { readonly state: "mismatch" };

export type ChangeCleanupRemote = {
  readonly readRemoteBranchHead: (input: {
    readonly repositoryCommonDirectory: string;
    readonly owner: string;
    readonly repo: string;
    readonly remoteName: string;
    readonly remoteUrl: string;
    readonly branchName: string;
  }) => RemoteBranchHeadResult;
  readonly deleteRemoteBranch: (input: {
    readonly repositoryCommonDirectory: string;
    readonly owner: string;
    readonly repo: string;
    readonly remoteName: string;
    readonly remoteUrl: string;
    readonly branchName: string;
    readonly expectedHeadSha: string;
  }) => boolean;
};

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
        | "remote_branch_head_mismatch"
        | "remote_branch_deletion_failed"
        | "reviewer_session_removal_failed";
    };

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
  if (input.worktreePath !== null && existsSync(input.worktreePath)) {
    const status = gitAtWorktree(input.worktreePath, [
      "status",
      "--porcelain=v1",
      "--untracked-files=normal",
    ]);
    if (!status.ok) return { state: "pending", blockingReason: "worktree_status_unavailable" };
    if (status.stdout.trim().length > 0) {
      return { state: "pending", blockingReason: "worktree_has_uncommitted_changes" };
    }
    if (
      !git(input.repositoryCommonDirectory, ["worktree", "remove", "--", input.worktreePath]).ok
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
  if (branchHead.ok) {
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
  const observed = remote.readRemoteBranchHead({
    repositoryCommonDirectory: input.repositoryCommonDirectory,
    owner: branch.owner,
    repo: branch.repo,
    remoteName: branch.remoteName,
    remoteUrl: branch.remoteUrl,
    branchName: branch.branchName,
  });
  if (observed.state === "missing") return { state: "complete" };
  if (observed.state === "unavailable") {
    return { state: "pending", blockingReason: "remote_branch_unavailable" };
  }
  if (observed.state === "mismatch") {
    return { state: "pending", blockingReason: "remote_branch_repository_mismatch" };
  }
  if (observed.headSha !== branch.expectedHeadSha) {
    return { state: "pending", blockingReason: "remote_branch_head_mismatch" };
  }
  if (
    remote.deleteRemoteBranch({
      repositoryCommonDirectory: input.repositoryCommonDirectory,
      owner: branch.owner,
      repo: branch.repo,
      remoteName: branch.remoteName,
      remoteUrl: branch.remoteUrl,
      branchName: branch.branchName,
      expectedHeadSha: branch.expectedHeadSha,
    })
  ) {
    return { state: "complete" };
  }
  const afterFailure = remote.readRemoteBranchHead({
    repositoryCommonDirectory: input.repositoryCommonDirectory,
    owner: branch.owner,
    repo: branch.repo,
    remoteName: branch.remoteName,
    remoteUrl: branch.remoteUrl,
    branchName: branch.branchName,
  });
  if (afterFailure.state === "missing") return { state: "complete" };
  if (afterFailure.state === "mismatch") {
    return { state: "pending", blockingReason: "remote_branch_repository_mismatch" };
  }
  if (afterFailure.state === "unavailable") {
    return { state: "pending", blockingReason: "remote_branch_unavailable" };
  }
  return afterFailure.headSha === branch.expectedHeadSha
    ? { state: "pending", blockingReason: "remote_branch_deletion_failed" }
    : { state: "pending", blockingReason: "remote_branch_head_mismatch" };
};

const localChangeCleanupRemote: ChangeCleanupRemote = {
  readRemoteBranchHead: (input) => {
    const repository = remoteRepositoryState(input);
    if (repository === "unavailable") return { state: "unavailable" };
    if (repository === "mismatch") return { state: "mismatch" };
    const result = git(input.repositoryCommonDirectory, [
      "ls-remote",
      "--heads",
      input.remoteName,
      `refs/heads/${input.branchName}`,
    ]);
    if (!result.ok) return { state: "unavailable" };
    const output = result.stdout.trim();
    if (output.length === 0) return { state: "missing" };
    const headSha = output.split(/\s+/, 1)[0];
    return headSha === undefined || headSha.length === 0
      ? { state: "unavailable" }
      : { state: "present", headSha };
  },
  deleteRemoteBranch: (input) =>
    remoteRepositoryState(input) === "matches" &&
    git(input.repositoryCommonDirectory, [
      "push",
      `--force-with-lease=refs/heads/${input.branchName}:${input.expectedHeadSha}`,
      input.remoteName,
      `:refs/heads/${input.branchName}`,
    ]).ok,
};

type RemoteRepositoryInput = Parameters<ChangeCleanupRemote["readRemoteBranchHead"]>[0];
type RemoteRepositoryState = "matches" | "mismatch" | "unavailable";

const remoteRepositoryState = (input: RemoteRepositoryInput): RemoteRepositoryState => {
  const configured = git(input.repositoryCommonDirectory, [
    "config",
    "--get",
    `remote.${input.remoteName}.url`,
  ]);
  if (!configured.ok || configured.stdout.trim().length === 0) return "unavailable";
  return sameRemoteRepository(configured.stdout.trim(), input) ? "matches" : "mismatch";
};

const sameRemoteRepository = (configuredUrl: string, input: RemoteRepositoryInput): boolean => {
  const configured = githubRepository(configuredUrl);
  const expected = githubRepository(input.remoteUrl);
  if (configured !== undefined && expected !== undefined) {
    return (
      configured.owner === input.owner &&
      configured.repo === input.repo &&
      expected.owner === input.owner &&
      expected.repo === input.repo
    );
  }
  return normalizeRemoteUrl(configuredUrl) === normalizeRemoteUrl(input.remoteUrl);
};

const githubRepository = (
  url: string,
): { readonly owner: string; readonly repo: string } | undefined => {
  const normalized = normalizeRemoteUrl(url);
  const match =
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(normalized) ??
    /^git@github\.com:([^/]+)\/([^/]+)$/.exec(normalized) ??
    /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+)$/.exec(normalized);
  return match === null ? undefined : { owner: match[1] ?? "", repo: match[2] ?? "" };
};

const normalizeRemoteUrl = (url: string): string => {
  const trimmed = url.trim().replace(/\/$/u, "");
  return trimmed.endsWith(".git") ? trimmed.slice(0, -4) : trimmed;
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

type GitResult = { readonly ok: true; readonly stdout: string } | { readonly ok: false };

const git = (commonDirectory: string, args: readonly string[]): GitResult =>
  runGit([`--git-dir=${commonDirectory}`, ...args]);

const gitAtWorktree = (worktreePath: string, args: readonly string[]): GitResult =>
  runGit(["-C", worktreePath, ...args]);

const runGit = (args: readonly string[]): GitResult => {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? { ok: true, stdout: result.stdout } : { ok: false };
};

const branchNameForRef = (branchRef: string): string | undefined => {
  const prefix = "refs/heads/";
  const branchName = branchRef.startsWith(prefix) ? branchRef.slice(prefix.length) : "";
  return branchName.length > 0 ? branchName : undefined;
};
