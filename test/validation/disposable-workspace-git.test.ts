import { rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  deleteDisposableWorkspaceRefWithDiagnostic,
  isDisposableWorktreeRemoved,
} from "../../src/disposableWorkspace/disposableWorkspaceGit.js";
import { runTestProcessOrThrow } from "../support/testProcess.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

describe("Disposable workspace Git cleanup verification", () => {
  it("requires both filesystem absence and exact Git registration absence", () => {
    const repository = initializedRepository();
    const worktreePath = join(repository, "validation-worktree");

    git(repository, "worktree", "add", "--detach", worktreePath, "main");
    expect(isDisposableWorktreeRemoved(repository, worktreePath)).toBe(false);

    rmSync(worktreePath, { recursive: true, force: true });
    expect(isDisposableWorktreeRemoved(repository, worktreePath)).toBe(false);

    git(repository, "worktree", "remove", "--force", worktreePath);
    expect(isDisposableWorktreeRemoved(repository, worktreePath)).toBe(true);
  });

  it("does not report a temporary ref removed when Git cannot verify its absence", () => {
    const missingRepository = join(createTestWorkspace(), "missing-repository");

    expect(
      deleteDisposableWorkspaceRefWithDiagnostic(
        missingRepository,
        "refs/but-why/validation-runs/test/validation",
      ),
    ).toMatchObject({
      state: "failed",
    });
  });
});

const initializedRepository = (): string => {
  const repository = createTestWorkspace();
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "But Why Test");
  git(repository, "config", "user.email", "but-why@example.test");
  git(repository, "commit", "--allow-empty", "-m", "Initialize repository");
  git(repository, "branch", "-M", "main");
  return repository;
};

const git = (cwd: string, ...args: readonly string[]): string =>
  runTestProcessOrThrow("git", args, { cwd });
