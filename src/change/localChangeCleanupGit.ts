import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, rmdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import type { RemoteChangeBranch } from "./change.js";

type RemoteUrlRewrite = {
  readonly base: string;
  readonly pattern: string;
  readonly kind: "insteadOf" | "pushInsteadOf";
};

export type RemoteBranchHeadResult =
  | { readonly state: "missing" }
  | {
      readonly state: "present";
      readonly headSha: string;
      readonly remoteUrl: string;
    }
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
    readonly resolvedRemoteUrl: string;
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
      resolvedRemoteUrl: observed.remoteUrl,
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
    const repository = resolveRemoteRepository(input);
    if (repository.state !== "matches") return { state: repository.state };
    const result = gitAtResolvedRemote(input.repositoryCommonDirectory, [
      "ls-remote",
      "--heads",
      repository.fetchUrl,
      `refs/heads/${input.branchName}`,
    ]);
    if (!result.ok) return { state: "unavailable" };
    const output = result.stdout.trim();
    if (output.length === 0) return { state: "missing" };
    const headSha = output.split(/\s+/, 1)[0];
    return headSha === undefined || headSha.length === 0
      ? { state: "unavailable" }
      : {
          state: "present",
          headSha,
          remoteUrl: repository.pushUrl,
        };
  },
  deleteRemoteBranch: (input) =>
    gitAtResolvedRemote(input.repositoryCommonDirectory, [
      "push",
      `--force-with-lease=refs/heads/${input.branchName}:${input.expectedHeadSha}`,
      input.resolvedRemoteUrl,
      `:refs/heads/${input.branchName}`,
    ]).ok,
};

type RemoteRepositoryInput = Parameters<ChangeCleanupRemote["readRemoteBranchHead"]>[0];
type RemoteRepositoryResolution =
  | {
      readonly state: "matches";
      readonly fetchUrl: string;
      readonly pushUrl: string;
    }
  | { readonly state: "mismatch" | "unavailable" };

const resolveRemoteRepository = (input: RemoteRepositoryInput): RemoteRepositoryResolution => {
  const rewrites = readRemoteUrlRewrites(input.repositoryCommonDirectory);
  if (rewrites === undefined) return { state: "unavailable" };
  const configured = readRemoteUrls(input.repositoryCommonDirectory, input.remoteName, "url");
  if (configured === undefined || configured.length !== 1) return { state: "mismatch" };
  if (!configured.every((url) => sameRemoteRepository(url, input))) {
    return { state: "mismatch" };
  }
  const fetchUrl = rewriteRemoteUrl(configured[0] as string, rewrites, "fetch");
  if (fetchUrl === undefined || !transportRepositoryMatches(fetchUrl, input)) {
    return { state: "mismatch" };
  }
  const configuredPushUrls = readRemoteUrls(
    input.repositoryCommonDirectory,
    input.remoteName,
    "pushurl",
  );
  if (configuredPushUrls === undefined) return { state: "unavailable" };
  const pushUrl =
    configuredPushUrls.length > 0
      ? (configuredPushUrls[0] as string)
      : rewriteRemoteUrl(configured[0] as string, rewrites, "push");
  return configuredPushUrls.length > 1 ||
    pushUrl === undefined ||
    !transportRepositoryMatches(pushUrl, input)
    ? { state: "mismatch" }
    : { state: "matches", fetchUrl, pushUrl };
};

const readRemoteUrlRewrites = (
  repositoryCommonDirectory: string,
): readonly RemoteUrlRewrite[] | undefined => {
  const result = git(repositoryCommonDirectory, [
    "config",
    "--get-regexp",
    "^url\\..*\\.(insteadof|pushinsteadof)$",
  ]);
  if (!result.ok || result.stdout.trim().length === 0) return [];
  const rewrites = result.stdout
    .trim()
    .split("\n")
    .map((line) => {
      const match = /^url\.(.+)\.(insteadof|pushinsteadof)\s+(.+)$/u.exec(line);
      return match === null
        ? undefined
        : {
            base: match[1] ?? "",
            kind: match[2] === "insteadof" ? ("insteadOf" as const) : ("pushInsteadOf" as const),
            pattern: match[3] ?? "",
          };
    });
  return rewrites.every((rewrite): rewrite is RemoteUrlRewrite => rewrite !== undefined)
    ? rewrites
    : undefined;
};

const readRemoteUrls = (
  repositoryCommonDirectory: string,
  remoteName: string,
  kind: "url" | "pushurl",
): readonly string[] | undefined => {
  const result = git(repositoryCommonDirectory, [
    "config",
    "--get-all",
    `remote.${remoteName}.${kind}`,
  ]);
  if (!result.ok) return kind === "pushurl" ? [] : undefined;
  return result.stdout
    .split("\n")
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
};

const rewriteRemoteUrl = (
  url: string,
  rewrites: readonly RemoteUrlRewrite[],
  direction: "fetch" | "push",
): string => {
  const pushRewrite =
    direction === "push" ? longestRewrite(url, rewrites, "pushInsteadOf") : undefined;
  const rewrite = pushRewrite ?? longestRewrite(url, rewrites, "insteadOf");
  return rewrite === undefined ? url : rewrite.base + url.slice(rewrite.pattern.length);
};

const longestRewrite = (
  url: string,
  rewrites: readonly RemoteUrlRewrite[],
  kind: RemoteUrlRewrite["kind"],
): RemoteUrlRewrite | undefined =>
  rewrites
    .filter((rewrite) => rewrite.kind === kind && url.startsWith(rewrite.pattern))
    .sort((left, right) => right.pattern.length - left.pattern.length)[0];

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

const transportRepositoryMatches = (url: string, input: RemoteRepositoryInput): boolean => {
  const repository = githubRepository(url);
  return (
    repository === undefined || (repository.owner === input.owner && repository.repo === input.repo)
  );
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

const gitAtResolvedRemote = (commonDirectory: string, args: readonly string[]): GitResult => {
  const temporaryGitDirectory = mkdtempSync(join(tmpdir(), "but-why-remote-cleanup-"));
  try {
    const initialized = runGitCommand(["init", "--bare", "-q", temporaryGitDirectory]);
    if (!initialized.ok) return initialized;
    const configured = runGitCommand([
      `--git-dir=${commonDirectory}`,
      "config",
      "--null",
      "--list",
    ]);
    if (!configured.ok) return configured;
    const copied = copyGitConfiguration(configured.stdout, join(temporaryGitDirectory, "config"));
    return copied
      ? runGitWithoutUrlRewrites([`--git-dir=${temporaryGitDirectory}`, ...args])
      : { ok: false };
  } finally {
    rmSync(temporaryGitDirectory, { recursive: true, force: true });
  }
};

const copyGitConfiguration = (value: string, destination: string): boolean => {
  for (const entry of value.split("\0").filter((item) => item.length > 0)) {
    const separator = entry.indexOf("\n");
    if (separator < 0) return false;
    const key = entry.slice(0, separator);
    const setting = entry.slice(separator + 1);
    if (key.startsWith("include") || /^url\..*\.(insteadof|pushinsteadof)$/u.test(key)) {
      continue;
    }
    if (!runGitCommand(["config", "--file", destination, "--add", key, setting]).ok) {
      return false;
    }
  }
  return true;
};

const runGit = (args: readonly string[]): GitResult => runGitCommand(args);

const runGitCommand = (args: readonly string[]): GitResult => {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? { ok: true, stdout: result.stdout } : { ok: false };
};

const runGitWithoutUrlRewrites = (args: readonly string[]): GitResult => {
  const result = spawnSync(
    "env",
    ["GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_NOSYSTEM=1", "git", ...args],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  return result.status === 0 ? { ok: true, stdout: result.stdout } : { ok: false };
};

const branchNameForRef = (branchRef: string): string | undefined => {
  const prefix = "refs/heads/";
  const branchName = branchRef.startsWith(prefix) ? branchRef.slice(prefix.length) : "";
  return branchName.length > 0 ? branchName : undefined;
};
