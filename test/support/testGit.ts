import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { runTestProcessOrThrow } from "./testProcess.js";
import { releaseTestWorkspace } from "./testWorkspace.js";

export const addRegisteredTestGitWorktree = (
  repositoryRoot: string,
  worktreePath: string,
  commitSha: string,
): void => {
  try {
    runTestProcessOrThrow("git", ["worktree", "add", "--detach", "--", worktreePath, commitSha], {
      cwd: repositoryRoot,
    });
  } catch (error) {
    try {
      removeRegisteredTestGitWorktree(repositoryRoot, worktreePath);
    } catch (cleanupError) {
      throw new Error(
        `Git worktree setup failed and cleanup was not verified: ${errorMessage(cleanupError)}`,
        { cause: error },
      );
    }
    throw error;
  }
};

export const removeRegisteredTestGitWorktree = (
  repositoryRoot: string,
  worktreePath: string,
): void => {
  const expectedPath = resolve(worktreePath);
  const before = registeredWorktreePaths(repositoryRoot);
  if (!before.includes(expectedPath)) {
    if (existsSync(expectedPath)) {
      throw new Error(`Git worktree exists without a registration: ${expectedPath}`);
    }
    return;
  }

  runTestProcessOrThrow("git", ["worktree", "remove", "--force", "--", expectedPath], {
    cwd: repositoryRoot,
  });

  const after = registeredWorktreePaths(repositoryRoot);
  if (after.includes(expectedPath) || existsSync(expectedPath)) {
    throw new Error(`Git worktree cleanup was not verified: ${expectedPath}`);
  }
};

export const releaseRegisteredTestGitRepository = (repositoryRoot: string): void => {
  const expectedRoot = resolve(repositoryRoot);
  const linkedWorktrees = registeredWorktreePaths(repositoryRoot).filter(
    (path) => path !== expectedRoot,
  );
  if (linkedWorktrees.length > 0) {
    throw new Error(
      `Git repository cleanup is blocked by registered worktrees: ${linkedWorktrees.join(", ")}`,
    );
  }
  releaseTestWorkspace(repositoryRoot);
  if (existsSync(expectedRoot)) {
    throw new Error(`Git repository cleanup was not verified: ${expectedRoot}`);
  }
};

const registeredWorktreePaths = (repositoryRoot: string): readonly string[] =>
  runTestProcessOrThrow("git", ["worktree", "list", "--porcelain"], { cwd: repositoryRoot })
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => resolve(line.slice("worktree ".length)));

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
