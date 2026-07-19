import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export type ChangeCleanupResult =
  | { readonly state: "complete" }
  | {
      readonly state: "pending";
      readonly blockingReason:
        | "worktree_has_uncommitted_changes"
        | "worktree_status_unavailable"
        | "worktree_removal_failed"
        | "branch_ref_invalid"
        | "branch_reachability_unavailable"
        | "branch_not_reachable_from_another_ref"
        | "branch_deletion_failed";
    };

export const cleanupChangeResources = (input: {
  readonly repositoryCommonDirectory: string;
  readonly worktreePath: string | null;
  readonly branchRef: string;
}): ChangeCleanupResult => {
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

  const branchName = branchNameForRef(input.branchRef);
  if (branchName === undefined) return { state: "pending", blockingReason: "branch_ref_invalid" };
  const branchHead = git(input.repositoryCommonDirectory, [
    "rev-parse",
    "--verify",
    `${input.branchRef}^{commit}`,
  ]);
  if (!branchHead.ok) return { state: "complete" };

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
  return git(input.repositoryCommonDirectory, ["branch", "-D", "--", branchName]).ok
    ? { state: "complete" }
    : { state: "pending", blockingReason: "branch_deletion_failed" };
};

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
