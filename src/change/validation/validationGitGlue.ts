import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { CleanupState } from "../validationRun/cleanup.js";

const zeroSha = "0000000000000000000000000000000000000000";
const validationGitOperationTimeoutMs = 5_000;

export const ensureValidationTempRef = (
  repoRoot: string,
  tempRefName: string,
  submittedSha: string,
): { readonly ok: true } | { readonly ok: false; readonly message: string } => {
  const existing = git(repoRoot, ["rev-parse", "--verify", `${tempRefName}^{commit}`]);

  if (existing.ok) {
    const existingSha = existing.stdout.trim();

    if (existingSha === submittedSha) {
      return { ok: true };
    }

    return {
      ok: false,
      message: `Validation temp ref ${tempRefName} already points to ${existingSha}, not ${submittedSha}.`,
    };
  }

  const created = git(repoRoot, ["update-ref", "--no-deref", tempRefName, submittedSha, zeroSha]);

  if (created.ok) {
    return { ok: true };
  }

  const raced = git(repoRoot, ["rev-parse", "--verify", `${tempRefName}^{commit}`]);

  if (raced.ok && raced.stdout.trim() === submittedSha) {
    return { ok: true };
  }

  return { ok: false, message: created.message };
};

export const inspectExistingWorktree = (
  worktreePath: string,
):
  | { readonly exists: false }
  | {
      readonly exists: true;
      readonly branch: string | undefined;
      readonly head: string | undefined;
      readonly dirty: boolean;
    } => {
  if (!existsSync(worktreePath)) {
    return { exists: false };
  }

  const branch = git(worktreePath, ["rev-parse", "--symbolic-full-name", "HEAD"]);
  const head = git(worktreePath, ["rev-parse", "HEAD"]);
  const status = git(worktreePath, ["status", "--porcelain=v1"]);

  return {
    exists: true,
    branch: branch.ok ? branch.stdout.trim() : undefined,
    head: head.ok ? head.stdout.trim() : undefined,
    dirty: !status.ok || status.stdout.trim().length > 0,
  };
};

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
