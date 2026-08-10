import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { validationWorkspaceCleanupGit } from "../../src/change/validation/validationWorkspaceCleanupGit.js";
import {
  expectedSandcastleWorktreePath,
  validationTempRefName,
} from "../../src/change/validation/validationWorkspacePath.js";
import { isDisposableWorktreeRemoved } from "../../src/disposableWorkspace/disposableWorkspaceGit.js";
import { runTestProcess, runTestProcessOrThrow } from "../support/testProcess.js";
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

  it("removes one exact temporary ref and worktree idempotently", () => {
    const repository = initializedRepository();
    const commitSha = git(repository, "rev-parse", "HEAD");
    const validationRunId = "run-1";
    const tempRefName = validationTempRefName(validationRunId);
    const worktreePath = expectedSandcastleWorktreePath(repository, tempRefName);
    createValidationResources(repository, tempRefName, worktreePath, commitSha);
    const cleanup = validationWorkspaceCleanupGit(repository);
    const input = {
      validationRunId,
      submittedSha: commitSha,
      recordedTempRefName: tempRefName,
      recordedWorktreePath: worktreePath,
    };

    expect(cleanup.cleanup(input)).toEqual({
      worktree: "removed",
      tempRef: "removed",
    });
    expect(cleanup.cleanup(input)).toEqual({
      worktree: "removed",
      tempRef: "removed",
    });
    expect(existsSync(worktreePath)).toBe(false);
    expect(refExists(repository, tempRefName)).toBe(false);
  });

  it("leaves real Git resources untouched when the recorded targets mismatch", () => {
    const repository = initializedRepository();
    const commitSha = git(repository, "rev-parse", "HEAD");
    const validationRunId = "selected";
    const expectedRef = validationTempRefName(validationRunId);
    const expectedPath = expectedSandcastleWorktreePath(repository, expectedRef);
    const unrelatedRef = validationTempRefName("unrelated");
    const unrelatedPath = expectedSandcastleWorktreePath(repository, unrelatedRef);
    createValidationResources(repository, expectedRef, expectedPath, commitSha);
    createValidationResources(repository, unrelatedRef, unrelatedPath, commitSha);

    expect(
      validationWorkspaceCleanupGit(repository).cleanup({
        validationRunId,
        submittedSha: commitSha,
        recordedTempRefName: unrelatedRef,
        recordedWorktreePath: unrelatedPath,
      }),
    ).toEqual({
      worktree: "failed",
      tempRef: "failed",
      errorMessage:
        "Recorded Validation Workspace identity does not match its selected Validation Run.",
    });
    expect(existsSync(expectedPath)).toBe(true);
    expect(existsSync(unrelatedPath)).toBe(true);
    expect(refExists(repository, expectedRef)).toBe(true);
    expect(refExists(repository, unrelatedRef)).toBe(true);
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

const createValidationResources = (
  repository: string,
  tempRefName: string,
  worktreePath: string,
  commitSha: string,
): void => {
  git(repository, "update-ref", tempRefName, commitSha);
  git(repository, "worktree", "add", worktreePath, tempRefName);
};

const refExists = (repository: string, tempRefName: string): boolean =>
  runTestProcess("git", ["show-ref", "--verify", tempRefName], { cwd: repository }).status === 0;

const git = (cwd: string, ...args: readonly string[]): string =>
  runTestProcessOrThrow("git", args, { cwd });
