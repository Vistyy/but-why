import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { runTestProcessOrThrow } from "./testProcess.js";
import { releaseTestWorkspace } from "./testWorkspace.js";

const trackedWorktrees = new Map<string, Set<string>>();

export const addRegisteredTestGitWorktree = (
  repositoryRoot: string,
  worktreePath: string,
  commitSha: string,
): void => {
  const expectedRoot = resolve(repositoryRoot);
  const expectedPath = resolve(worktreePath);
  trackedWorktreesFor(expectedRoot).add(expectedPath);
  if (registeredWorktreePaths(expectedRoot).includes(expectedPath)) {
    throw new Error(`Git worktree path is already registered: ${expectedPath}`);
  }
  try {
    runTestProcessOrThrow("git", ["worktree", "add", "--detach", "--", worktreePath, commitSha], {
      cwd: expectedRoot,
    });
  } catch (error) {
    try {
      removeRegisteredTestGitWorktree(expectedRoot, expectedPath);
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
  const expectedRoot = resolve(repositoryRoot);
  const expectedPath = resolve(worktreePath);
  const before = registeredWorktreePaths(expectedRoot);
  if (!before.includes(expectedPath)) {
    if (existsSync(expectedPath)) {
      throw new Error(`Git worktree exists without a registration: ${expectedPath}`);
    }
    trackedWorktreesFor(expectedRoot).delete(expectedPath);
    return;
  }

  runTestProcessOrThrow("git", ["worktree", "remove", "--force", "--", expectedPath], {
    cwd: expectedRoot,
  });

  const after = registeredWorktreePaths(expectedRoot);
  if (after.includes(expectedPath) || existsSync(expectedPath)) {
    throw new Error(`Git worktree cleanup was not verified: ${expectedPath}`);
  }
  trackedWorktreesFor(expectedRoot).delete(expectedPath);
};

export const releaseRegisteredTestGitRepository = (repositoryRoot: string): void => {
  const expectedRoot = resolve(repositoryRoot);
  const tracked = [...(trackedWorktrees.get(expectedRoot) ?? [])];
  if (tracked.length > 0) {
    throw new Error(
      `Git repository cleanup is blocked by unresolved worktrees: ${tracked.join(", ")}`,
    );
  }
  const linkedWorktrees = registeredWorktreePaths(expectedRoot).filter(
    (path) => path !== expectedRoot,
  );
  if (linkedWorktrees.length > 0) {
    throw new Error(
      `Git repository cleanup is blocked by registered worktrees: ${linkedWorktrees.join(", ")}`,
    );
  }
  releaseTestWorkspace(expectedRoot);
  if (existsSync(expectedRoot)) {
    throw new Error(`Git repository cleanup was not verified: ${expectedRoot}`);
  }
  trackedWorktrees.delete(expectedRoot);
};

const trackedWorktreesFor = (repositoryRoot: string): Set<string> => {
  const existing = trackedWorktrees.get(repositoryRoot);
  if (existing !== undefined) return existing;
  const created = new Set<string>();
  trackedWorktrees.set(repositoryRoot, created);
  return created;
};

const registeredWorktreePaths = (repositoryRoot: string): readonly string[] =>
  runTestProcessOrThrow("git", ["worktree", "list", "--porcelain"], { cwd: repositoryRoot })
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => resolve(line.slice("worktree ".length)));

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
