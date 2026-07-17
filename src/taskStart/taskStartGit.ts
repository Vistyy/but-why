import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

import { decodeRepoConfigSource } from "../init/repoConfig.js";
import {
  recordedRemoteDefaultLocalBranches,
  resolveLocalBranch,
} from "../changeCandidateCapture/localGitCandidate.js";
import type { RepoLocalContext } from "../init/repoContext.js";
import type { PublicTaskId } from "../task/taskId.js";
import { taskSlugForId } from "../task/taskId.js";
import type { TaskStartRecord } from "./taskStart.js";

export type TaskStartGitIntent = {
  readonly repositoryCommonDirectory: string;
  readonly baseRef: string;
  readonly branchRef: string;
  readonly startingCommit: string;
  readonly worktreePath: string;
};

export type ResolveTaskStartGitResult =
  | { readonly ok: true; readonly intent: TaskStartGitIntent }
  | {
      readonly ok: false;
      readonly code:
        | "local_default_branch_missing"
        | "local_default_branch_ambiguous"
        | "local_default_branch_unavailable"
        | "committed_repo_config_missing"
        | "committed_repo_config_invalid"
        | "task_start_conflict";
    };

export type ProvisionTaskWorktreeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "task_start_conflict" | "git_tooling_error" };

export const resolveTaskStartGitIntent = (
  context: RepoLocalContext,
  taskId: PublicTaskId,
): ResolveTaskStartGitResult => {
  const recorded = recordedRemoteDefaultLocalBranches(context.root);
  if (recorded === undefined) return { ok: false, code: "local_default_branch_unavailable" };
  const defaults = [...new Set(recorded)];
  if (defaults.length === 0) return { ok: false, code: "local_default_branch_missing" };
  if (defaults.length > 1) return { ok: false, code: "local_default_branch_ambiguous" };

  const baseRef = defaults[0];
  if (baseRef === undefined) return { ok: false, code: "local_default_branch_missing" };
  const startingCommit = resolveLocalBranch(context.root, baseRef);
  if (startingCommit === undefined) {
    return { ok: false, code: "local_default_branch_unavailable" };
  }

  const configSource = git(context.root, "show", `${startingCommit}:.but-why/config.json`);
  if (!configSource.ok) return { ok: false, code: "committed_repo_config_missing" };

  const config = decodeRepoConfigSource(configSource.stdout);
  if (!config.ok || config.config.taskPrefix !== context.taskPrefix) {
    return { ok: false, code: "committed_repo_config_invalid" };
  }

  const slug = taskSlugForId(taskId);
  const branchRef = `refs/heads/but-why/${slug}`;
  if (resolveLocalBranch(context.root, branchRef) !== undefined) {
    return { ok: false, code: "task_start_conflict" };
  }
  return {
    ok: true,
    intent: {
      repositoryCommonDirectory: context.commonDirectory,
      baseRef,
      branchRef,
      startingCommit,
      worktreePath: join(context.commonDirectory, "but-why", "worktrees", slug),
    },
  };
};

export const provisionTaskWorktree = (
  cwd: string,
  start: TaskStartRecord,
  recovering: boolean,
): ProvisionTaskWorktreeResult => {
  const worktreesResult = git(cwd, "worktree", "list", "--porcelain");
  if (!worktreesResult.ok) return { ok: false, code: "git_tooling_error" };

  const worktree = inspectRecordedWorktree(start, parseWorktrees(worktreesResult.stdout));
  if (worktree !== "missing" && worktree !== "stale") return worktree;

  const branch = ensureRecordedBranch(cwd, start, recovering);
  if (!branch.ok) return branch;
  if (worktree === "stale") {
    const removed = removeStaleWorktreeRegistration(cwd, start);
    if (!removed.ok) return removed;
  }
  return addRecordedWorktree(cwd, start);
};

const inspectRecordedWorktree = (
  start: TaskStartRecord,
  worktrees: readonly WorktreeEntry[],
): ProvisionTaskWorktreeResult | "missing" | "stale" => {
  const expectedPath = canonicalPathIfPresent(start.worktreePath);
  const listedAtPath = worktrees.find((entry) => entry.path === expectedPath);
  const listedForBranch = worktrees.find((entry) => entry.branchRef === start.branchRef);
  if (!pathEntryExists(start.worktreePath)) {
    if (listedAtPath === undefined && listedForBranch === undefined) return "missing";
    return listedAtPath?.branchRef === start.branchRef &&
      listedAtPath.prunable &&
      listedForBranch === listedAtPath
      ? "stale"
      : { ok: false, code: "task_start_conflict" };
  }
  return listedAtPath?.branchRef === start.branchRef &&
    listedForBranch?.path === expectedPath &&
    !lstatSync(start.worktreePath).isSymbolicLink()
    ? { ok: true }
    : { ok: false, code: "task_start_conflict" };
};

const ensureRecordedBranch = (
  cwd: string,
  start: TaskStartRecord,
  recovering: boolean,
): ProvisionTaskWorktreeResult => {
  const branchCommit = resolveLocalBranch(cwd, start.branchRef);
  if (branchCommit !== undefined) {
    return recovering &&
      (start.provisioningState === "ready" || branchCommit === start.startingCommit)
      ? { ok: true }
      : { ok: false, code: "task_start_conflict" };
  }
  if (recovering && start.provisioningState === "ready") {
    return { ok: false, code: "task_start_conflict" };
  }
  const branchName = start.branchRef.slice("refs/heads/".length);
  const create = git(cwd, "branch", branchName, start.startingCommit);
  return create.ok ? { ok: true } : { ok: false, code: "git_tooling_error" };
};

const removeStaleWorktreeRegistration = (
  cwd: string,
  start: TaskStartRecord,
): ProvisionTaskWorktreeResult => {
  const removed = git(cwd, "worktree", "remove", "--force", "--", start.worktreePath);
  if (!removed.ok) return { ok: false, code: "git_tooling_error" };
  const listed = git(cwd, "worktree", "list", "--porcelain");
  if (!listed.ok) return { ok: false, code: "git_tooling_error" };
  const registrations = parseWorktrees(listed.stdout);
  return registrations.some(
    (entry) => entry.path === start.worktreePath || entry.branchRef === start.branchRef,
  )
    ? { ok: false, code: "task_start_conflict" }
    : { ok: true };
};

const addRecordedWorktree = (cwd: string, start: TaskStartRecord): ProvisionTaskWorktreeResult => {
  try {
    mkdirSync(dirname(start.worktreePath), { recursive: true });
  } catch {
    return { ok: false, code: "git_tooling_error" };
  }
  const branchName = start.branchRef.slice("refs/heads/".length);
  const add = git(cwd, "worktree", "add", start.worktreePath, branchName);
  return add.ok ? { ok: true } : { ok: false, code: "git_tooling_error" };
};

type WorktreeEntry = {
  readonly path: string;
  readonly branchRef?: string;
  readonly prunable: boolean;
};

const parseWorktrees = (source: string): readonly WorktreeEntry[] =>
  source
    .split("\n\n")
    .map((block) => {
      const lines = block.split("\n");
      const path = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
      const branchRef = lines.find((line) => line.startsWith("branch "))?.slice("branch ".length);
      return path === undefined
        ? undefined
        : {
            path: canonicalPathIfPresent(path),
            ...(branchRef === undefined ? {} : { branchRef }),
            prunable: lines.some((line) => line.startsWith("prunable")),
          };
    })
    .filter((entry): entry is WorktreeEntry => entry !== undefined);

const canonicalPathIfPresent = (path: string): string =>
  existsSync(path) ? realpathSync(path) : path;

const pathEntryExists = (path: string): boolean => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

type GitResult =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly stderr: string };

const git = (cwd: string, ...args: readonly string[]): GitResult => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status === 0
    ? { ok: true, stdout: result.stdout.trim() }
    : { ok: false, stderr: result.stderr.trim() };
};
