import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { snapshotWorkspaceCleanupGit } from "../../src/change/validation/adapters/snapshotWorkspaceCleanupGit.js";
import { expectedSnapshotWorkspacePath } from "../../src/change/validation/snapshotWorkspacePath.js";
import { executeHostCommandEffect } from "../../src/command/hostCommand.js";
import { WorkspaceCommandExecutionFailed } from "../../src/command/workspaceCommand.js";
import { restoreDisposableWorkspace } from "../../src/disposableWorkspace/adapters/disposableWorkspaceGit.js";
import { expectedTaskReviewWorkspacePath } from "../../src/task/review/taskReviewWorkspace.js";
import { runTestProcessOrThrow } from "../support/testProcess.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

describe("Snapshot Workspace Git cleanup verification", () => {
  it("namespaces independent Task Review and Validation Run identities", () => {
    const commonDirectory = "/tmp/repository/.git";

    expect(expectedTaskReviewWorkspacePath(commonDirectory, 1)).not.toBe(
      expectedSnapshotWorkspacePath(commonDirectory, 1),
    );
    expect(expectedTaskReviewWorkspacePath(commonDirectory, 1)).toContain("task-review-1");
    expect(expectedSnapshotWorkspacePath(commonDirectory, 1)).toContain("validation-run-1");
  });

  it.effect("removes one exact detached worktree idempotently", () =>
    Effect.gen(function* () {
      const repository = initializedRepository();
      const commonDirectory = repositoryCommonDirectory(repository);
      const commitSha = git(repository, "rev-parse", "HEAD");
      const validationRunId = 1;
      const worktreePath = expectedSnapshotWorkspacePath(commonDirectory, validationRunId);
      createSnapshotWorkspace(repository, worktreePath, commitSha);
      const cleanup = snapshotWorkspaceCleanupGit(repository, commonDirectory);
      const input = { validationRunId, submittedSha: commitSha };

      expect(yield* cleanup.cleanup(input)).toEqual({ workspace: "removed" });
      expect(yield* cleanup.cleanup(input)).toEqual({ workspace: "removed" });
      expect(existsSync(worktreePath)).toBe(false);
    }),
  );

  it.effect("restores tracked state and removes non-ignored files after an invocation", () =>
    Effect.gen(function* () {
      const repository = initializedRepository();
      const commonDirectory = repositoryCommonDirectory(repository);
      const commitSha = git(repository, "rev-parse", "HEAD");
      const worktreePath = expectedSnapshotWorkspacePath(commonDirectory, 131);
      createSnapshotWorkspace(repository, worktreePath, commitSha);
      writeFileSync(join(worktreePath, "tracked"), "changed\n");
      git(worktreePath, "add", "tracked");
      writeFileSync(join(worktreePath, "untracked"), "remove\n");
      writeFileSync(join(worktreePath, "ignored"), "keep\n");
      mkdirSync(join(worktreePath, "nested"));
      git(worktreePath, "init", "-q", "nested");

      const commandExecutor = (command: string, options?: { readonly cwd?: string }) =>
        executeHostCommandEffect({
          command: "sh",
          args: ["-c", command],
          cwd: options?.cwd ?? worktreePath,
        }).pipe(
          Effect.mapError(
            (error) => new WorkspaceCommandExecutionFailed({ message: error.message }),
          ),
        );
      yield* restoreDisposableWorkspace({
        commandExecutor,
        commandCwd: worktreePath,
        expectedCommitSha: commitSha,
        workspaceIdentity: {
          repositoryRoot: repository,
          repositoryCommonDirectory: commonDirectory,
          workspaceId: "validation-run-131",
        },
      });

      expect(git(worktreePath, "rev-parse", "HEAD")).toBe(commitSha);
      expect(git(worktreePath, "show", "HEAD:tracked")).toBe("candidate");
      expect(git(worktreePath, "status", "--porcelain=v1")).toBe("");
      expect(existsSync(join(worktreePath, "untracked"))).toBe(false);
      expect(existsSync(join(worktreePath, "ignored"))).toBe(true);
      expect(existsSync(join(worktreePath, "nested"))).toBe(false);
    }),
  );

  it.effect("leaves resources untouched when the Git Common Directory mismatches", () =>
    Effect.gen(function* () {
      const repository = initializedRepository();
      const commonDirectory = repositoryCommonDirectory(repository);
      const commitSha = git(repository, "rev-parse", "HEAD");
      const worktreePath = expectedSnapshotWorkspacePath(commonDirectory, 130);
      createSnapshotWorkspace(repository, worktreePath, commitSha);

      const unrelatedCommonDirectory = join(repository, "unrelated-common-directory");
      const result = yield* snapshotWorkspaceCleanupGit(
        repository,
        unrelatedCommonDirectory,
      ).cleanup({
        validationRunId: 130,
        submittedSha: commitSha,
      });

      expect(result).toMatchObject({
        workspace: "failed",
        errorMessage: expect.stringContaining(
          "Local Repository Git Common Directory does not match Shared Repository State.",
        ),
      });
      expect(existsSync(worktreePath)).toBe(true);
    }),
  );

  it.effect("removes a registered product-owned worktree after its HEAD changes", () =>
    Effect.gen(function* () {
      const repository = initializedRepository();
      const commonDirectory = repositoryCommonDirectory(repository);
      const submittedSha = git(repository, "rev-parse", "HEAD");
      writeFileSync(join(repository, "tracked"), "successor\n");
      git(repository, "add", "tracked");
      git(repository, "commit", "-m", "Successor");
      const unrelatedSha = git(repository, "rev-parse", "HEAD");
      const worktreePath = expectedSnapshotWorkspacePath(commonDirectory, 130);
      createSnapshotWorkspace(repository, worktreePath, unrelatedSha);
      writeFileSync(join(worktreePath, "tracked"), "changed\n");
      writeFileSync(join(worktreePath, "untracked"), "untracked\n");

      const result = yield* snapshotWorkspaceCleanupGit(repository, commonDirectory).cleanup({
        validationRunId: 130,
        submittedSha,
      });

      expect(result).toEqual({ workspace: "removed" });
      expect(existsSync(worktreePath)).toBe(false);
    }),
  );
});

const initializedRepository = (): string => {
  const repository = createTestWorkspace();
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "But Why Test");
  git(repository, "config", "user.email", "but-why@example.test");
  writeFileSync(join(repository, "tracked"), "candidate\n");
  writeFileSync(join(repository, ".gitignore"), "ignored\n");
  git(repository, "add", "tracked", ".gitignore");
  git(repository, "commit", "-m", "Initialize repository");
  return repository;
};

const repositoryCommonDirectory = (repository: string): string =>
  git(repository, "rev-parse", "--path-format=absolute", "--git-common-dir");

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
