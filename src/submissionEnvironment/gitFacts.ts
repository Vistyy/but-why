import { spawnSync } from "node:child_process";

export type GitCommandResult =
  | {
      readonly ok: true;
      readonly stdout: string;
    }
  | {
      readonly ok: false;
    };

export type GitFacts = {
  readonly branch: string;
  readonly commitSha: string;
};

export type GitFactsResult =
  | {
      readonly ok: true;
      readonly facts: GitFacts;
    }
  | {
      readonly ok: false;
      readonly code: "CURRENT_BRANCH_REQUIRED" | "WORKTREE_NOT_CLEAN" | "GIT_TOOLING_ERROR";
    };

export type GitCommandRunner = (args: readonly string[], cwd: string) => GitCommandResult;

export const runGitCommand: GitCommandRunner = (args, cwd) => {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  if (result.status !== 0) {
    return { ok: false };
  }

  return { ok: true, stdout: result.stdout };
};

export type ReadGitFactsOptions = {
  readonly allowedUntrackedFiles?: readonly string[];
};

export const readGitFacts = (
  cwd: string,
  runGit: GitCommandRunner = runGitCommand,
  options: ReadGitFactsOptions = {},
): GitFactsResult => {
  const branch = runGit(["branch", "--show-current"], cwd);

  if (!branch.ok) {
    return { ok: false, code: "GIT_TOOLING_ERROR" };
  }

  const branchName = branch.stdout.trim();

  if (branchName.length === 0) {
    return { ok: false, code: "CURRENT_BRANCH_REQUIRED" };
  }

  const status = runGit(["status", "--porcelain=v1", "--untracked-files=all"], cwd);

  if (!status.ok) {
    return { ok: false, code: "GIT_TOOLING_ERROR" };
  }

  if (dirtyStatusLines(status.stdout, options.allowedUntrackedFiles ?? []).length > 0) {
    return { ok: false, code: "WORKTREE_NOT_CLEAN" };
  }

  const commit = runGit(["rev-parse", "HEAD"], cwd);

  if (!commit.ok) {
    return { ok: false, code: "GIT_TOOLING_ERROR" };
  }

  const commitSha = commit.stdout.trim();

  if (commitSha.length === 0) {
    return { ok: false, code: "GIT_TOOLING_ERROR" };
  }

  return {
    ok: true,
    facts: {
      branch: branchName,
      commitSha,
    },
  };
};

const dirtyStatusLines = (
  status: string,
  allowedUntrackedFiles: readonly string[],
): readonly string[] =>
  status
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .filter((line) => !isAllowedUntrackedLine(line, allowedUntrackedFiles));

const isAllowedUntrackedLine = (
  line: string,
  allowedUntrackedFiles: readonly string[],
): boolean => {
  if (!line.startsWith("?? ")) {
    return false;
  }

  const path = line.slice(3);

  return allowedUntrackedFiles.includes(path);
};
