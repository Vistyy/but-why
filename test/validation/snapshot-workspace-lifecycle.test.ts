import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { describe } from "vitest";

import { makeCreateSnapshotWorkspace } from "../../src/change/validation/createSnapshotWorkspace.js";
import { expectedSnapshotWorkspacePath } from "../../src/change/validation/snapshotWorkspacePath.js";
import { InfrastructureToolingFailed } from "../../src/change/validation/validationToolingFailures.js";
import { runDisposableExactCommitWorkspace } from "../../src/disposableWorkspace/adapters/runDisposableExactCommitWorkspace.js";
import { observeUntil } from "../support/observe.js";
import { runTestProcessExpectExit, runTestProcessOrThrow } from "../support/testProcess.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const validationRunId = 1;
const snapshotWorkspaceProcessTestTimeoutMs = 90_000;
const createSnapshotWorkspace = makeCreateSnapshotWorkspace(runDisposableExactCommitWorkspace);

describe("Snapshot Workspace lifecycle", () => {
  it.scoped("creates an exact detached worktree without local file copying and removes it", () =>
    Effect.gen(function* () {
      const repository = initializedRepository();
      const commonDirectory = repositoryCommonDirectory(repository);
      const commitSha = git(repository, "rev-parse", "HEAD");
      writeFileSync(join(repository, ".env.test"), "LOCAL_INPUT=yes\n");
      const worktreePath = expectedSnapshotWorkspacePath(commonDirectory, validationRunId);
      const cleanupResults: unknown[] = [];

      const result = yield* createSnapshotWorkspace({
        repositoryRoot: repository,
        repositoryCommonDirectory: commonDirectory,
        validationRunId,
        submittedSha: commitSha,
        recordWorkspaceCleanup: (cleanupResult) =>
          Effect.sync(() => {
            cleanupResults.push(cleanupResult);
          }),
        runInWorkspace: (workspace) =>
          Effect.gen(function* () {
            expect(gitStatus(workspace.worktreePath, "symbolic-ref", "-q", "HEAD")).toBe(1);
            const observed = yield* workspace.commandExecutor(
              "test ! -e .env.test && git rev-parse HEAD",
            );
            expect(observed).toMatchObject({
              exitCode: 0,
              stdout: `${commitSha}\n`,
            });
            return { outcome: "passed" as const };
          }).pipe(
            Effect.mapError(
              (cause) =>
                new InfrastructureToolingFailed({
                  operationName: "test_workspace_command",
                  message: cause.message,
                }),
            ),
          ),
      });

      expect(result).toEqual({
        ok: true,
        activeWorkspaceResult: { outcome: "passed" },
      });
      expect(cleanupResults).toEqual([{ workspace: "removed" }]);
      expect(existsSync(worktreePath)).toBe(false);
      expect(git(repository, "for-each-ref", "--format=%(refname)", "refs/but-why")).toBe("");
    }),
  );

  it.scoped("reuses only the same clean detached worktree at the exact commit", () =>
    Effect.gen(function* () {
      const repository = initializedRepository();
      const commonDirectory = repositoryCommonDirectory(repository);
      const commitSha = git(repository, "rev-parse", "HEAD");
      const worktreePath = expectedSnapshotWorkspacePath(commonDirectory, validationRunId);
      mkdirSync(dirname(worktreePath), { recursive: true });
      git(repository, "worktree", "add", "--detach", "--", worktreePath, commitSha);

      const result = yield* createSnapshotWorkspace({
        repositoryRoot: repository,
        repositoryCommonDirectory: commonDirectory,
        validationRunId,
        submittedSha: commitSha,
      });

      expect(result).toEqual({ ok: true });
      expect(existsSync(worktreePath)).toBe(false);
    }),
  );

  it.scoped("refuses a path whose Local Repository registration cannot be proved", () =>
    Effect.gen(function* () {
      const repository = initializedRepository();
      const commonDirectory = repositoryCommonDirectory(repository);
      const commitSha = git(repository, "rev-parse", "HEAD");
      const worktreePath = expectedSnapshotWorkspacePath(commonDirectory, validationRunId);
      mkdirSync(worktreePath, { recursive: true });
      writeFileSync(join(worktreePath, "keep"), "unowned\n");
      const cleanupResults: unknown[] = [];

      const result = yield* createSnapshotWorkspace({
        repositoryRoot: repository,
        repositoryCommonDirectory: commonDirectory,
        validationRunId,
        submittedSha: commitSha,
        recordWorkspaceCleanup: (cleanupResult) =>
          Effect.sync(() => {
            cleanupResults.push(cleanupResult);
          }),
      });

      expect(result).toMatchObject({
        ok: false,
        toolingError: {
          operationName: "create_snapshot_workspace",
          cleanupResult: { workspace: "failed" },
        },
      });
      expect(cleanupResults).toEqual([
        {
          workspace: "failed",
          errorMessage: "Snapshot Workspace path exists without a Local Repository registration.",
        },
      ]);
      expect(existsSync(join(worktreePath, "keep"))).toBe(true);
    }),
  );

  it.scoped(
    "terminates an interrupted command before cleanup records success",
    () =>
      Effect.gen(function* () {
        const repository = initializedRepository();
        const commonDirectory = repositoryCommonDirectory(repository);
        const commitSha = git(repository, "rev-parse", "HEAD");
        const worktreePath = expectedSnapshotWorkspacePath(commonDirectory, validationRunId);
        const evidenceRoot = createTestWorkspace();
        const processIdPath = join(evidenceRoot, "child-pid");
        const cleanupResults: unknown[] = [];
        const fiber = yield* Effect.fork(
          createSnapshotWorkspace({
            repositoryRoot: repository,
            repositoryCommonDirectory: commonDirectory,
            validationRunId,
            submittedSha: commitSha,
            recordWorkspaceCleanup: (cleanupResult) =>
              Effect.sync(() => {
                cleanupResults.push(cleanupResult);
              }),
            runInWorkspace: (workspace) =>
              workspace
                .commandExecutor(
                  `sleep 30 & child=$!; printf '%s' "$child" > '${processIdPath}'; wait "$child"`,
                )
                .pipe(
                  Effect.mapError(
                    (cause) =>
                      new InfrastructureToolingFailed({
                        operationName: "interrupted_test_command",
                        message: cause.message,
                      }),
                  ),
                  Effect.as({ outcome: "passed" as const }),
                ),
          }),
        );
        yield* Effect.addFinalizer(() => Fiber.interrupt(fiber).pipe(Effect.asVoid));
        yield* Effect.promise(() =>
          observeUntil({
            description: `file ${processIdPath} to contain a child PID`,
            observe: () => {
              try {
                return readFileSync(processIdPath, "utf8");
              } catch {
                return "";
              }
            },
            isReady: (contents) => contents.length > 0,
            timeoutMs: 5_000,
          }),
        );
        const childProcessId = readFileSync(processIdPath, "utf8");
        yield* Fiber.interrupt(fiber);

        expect(cleanupResults).toEqual([{ workspace: "removed" }]);
        expect(existsSync(worktreePath)).toBe(false);
        runTestProcessExpectExit("kill", ["-0", childProcessId], { cwd: repository }, 1);
      }),
    snapshotWorkspaceProcessTestTimeoutMs,
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
  git(repository, "branch", "-M", "main");
  return repository;
};

const repositoryCommonDirectory = (repository: string): string =>
  git(repository, "rev-parse", "--path-format=absolute", "--git-common-dir");

const gitStatus = (cwd: string, ...args: readonly string[]): number =>
  runTestProcessExpectExit("git", args, { cwd }, 1).status ?? -1;

const git = (cwd: string, ...args: readonly string[]): string =>
  runTestProcessOrThrow("git", args, { cwd });
