import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { CleanupState } from "../validationRun/cleanup.js";

const validationGitOperationTimeoutMs = 30_000;

export const removeValidationWorktree = (repoRoot: string, worktreePath: string): boolean => {
  git(repoRoot, ["worktree", "remove", "--force", worktreePath]);

  return isValidationWorktreeRemoved(repoRoot, worktreePath);
};

export const isValidationWorktreeRemoved = (repoRoot: string, worktreePath: string): boolean => {
  if (existsSync(worktreePath)) return false;

  const worktrees = git(repoRoot, ["worktree", "list", "--porcelain"]);
  if (!worktrees.ok) return false;

  return !worktreePaths(worktrees.stdout).includes(resolve(worktreePath));
};

const worktreePaths = (porcelain: string): readonly string[] =>
  porcelain
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => resolve(line.slice("worktree ".length)));

export const deleteValidationTempRef = (repoRoot: string, tempRefName: string): CleanupState => {
  const result = git(repoRoot, ["update-ref", "-d", tempRefName]);

  if (result.ok) {
    return "removed";
  }

  return git(repoRoot, ["rev-parse", "--verify", `${tempRefName}^{commit}`]).ok
    ? "failed"
    : "removed";
};

type GitResult =
  | {
      readonly ok: true;
      readonly stdout: string;
    }
  | {
      readonly ok: false;
      readonly message: string;
    };

const git = (cwd: string, args: readonly string[]): GitResult => {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: validationGitOperationTimeoutMs,
  });

  if (result.status === 0) {
    return { ok: true, stdout: result.stdout };
  }

  return {
    ok: false,
    message: [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n"),
  };
};
