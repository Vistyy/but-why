import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { runTestProcessOrThrow } from "./testProcess.js";

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

const registeredWorktreePaths = (repositoryRoot: string): readonly string[] =>
  runTestProcessOrThrow("git", ["worktree", "list", "--porcelain"], { cwd: repositoryRoot })
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => resolve(line.slice("worktree ".length)));
