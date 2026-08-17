import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { snapshotWorkspaceCleanupGit } from "../../src/change/validation/adapters/snapshotWorkspaceCleanupGit.js";
import { expectedSnapshotWorkspacePath } from "../../src/change/validation/snapshotWorkspacePath.js";
import { runTestProcessOrThrow } from "../support/testProcess.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

describe("Snapshot Workspace Git cleanup verification", () => {
  it.effect("removes one exact detached worktree idempotently", () =>
    Effect.gen(function* () {
      const repository = initializedRepository();
      const commitSha = git(repository, "rev-parse", "HEAD");
      const validationRunId = 1;
      const worktreePath = expectedSnapshotWorkspacePath(repository, validationRunId);
      createSnapshotWorkspace(repository, worktreePath, commitSha);
      const cleanup = snapshotWorkspaceCleanupGit(repository);
      const input = {
        validationRunId,
        submittedSha: commitSha,
        recordedWorktreePath: worktreePath,
      };

      expect(yield* cleanup.cleanup(input)).toEqual({ workspace: "removed" });
      expect(yield* cleanup.cleanup(input)).toEqual({ workspace: "removed" });
      expect(existsSync(worktreePath)).toBe(false);
    }),
  );

  it.effect("leaves resources untouched when persisted identity mismatches", () =>
    Effect.gen(function* () {
      const repository = initializedRepository();
      const commitSha = git(repository, "rev-parse", "HEAD");
      const selectedPath = expectedSnapshotWorkspacePath(repository, 130);
      const unrelatedPath = expectedSnapshotWorkspacePath(repository, 131);
      createSnapshotWorkspace(repository, selectedPath, commitSha);
      createSnapshotWorkspace(repository, unrelatedPath, commitSha);

      const result = yield* snapshotWorkspaceCleanupGit(repository).cleanup({
        validationRunId: 130,
        submittedSha: commitSha,
        recordedWorktreePath: unrelatedPath,
      });

      expect(result).toEqual({
        workspace: "failed",
        errorMessage: `Recorded Snapshot Workspace identity does not match the expected workspace identity. Expected ${selectedPath}; received ${unrelatedPath}.`,
      });
      expect(existsSync(selectedPath)).toBe(true);
      expect(existsSync(unrelatedPath)).toBe(true);
    }),
  );

  it.effect("leaves a registered worktree with an unrelated HEAD untouched", () =>
    Effect.gen(function* () {
      const repository = initializedRepository();
      const submittedSha = git(repository, "rev-parse", "HEAD");
      writeFileSync(join(repository, "tracked"), "successor\n");
      git(repository, "add", "tracked");
      git(repository, "commit", "-m", "Successor");
      const unrelatedSha = git(repository, "rev-parse", "HEAD");
      const worktreePath = expectedSnapshotWorkspacePath(repository, 130);
      createSnapshotWorkspace(repository, worktreePath, unrelatedSha);

      const result = yield* snapshotWorkspaceCleanupGit(repository).cleanup({
        validationRunId: 130,
        submittedSha: submittedSha,
        recordedWorktreePath: worktreePath,
      });

      expect(result).toMatchObject({ workspace: "failed" });
      expect(existsSync(worktreePath)).toBe(true);
      expect(git(worktreePath, "rev-parse", "HEAD")).toBe(unrelatedSha);
    }),
  );
});

const initializedRepository = (): string => {
  const repository = createTestWorkspace();
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "But Why Test");
  git(repository, "config", "user.email", "but-why@example.test");
  writeFileSync(join(repository, "tracked"), "candidate\n");
  git(repository, "add", "tracked");
  git(repository, "commit", "-m", "Initialize repository");
  return repository;
};

const createSnapshotWorkspace = (
  repository: string,
  worktreePath: string,
  commitSha: string,
): void => {
  mkdirSync(dirname(worktreePath), { recursive: true });
  git(repository, "worktree", "add", "--detach", "--", worktreePath, commitSha);
};

const git = (cwd: string, ...args: readonly string[]): string =>
  runTestProcessOrThrow("git", args, { cwd });
