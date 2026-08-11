import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { describe } from "vitest";

import { makeCreateSnapshotWorkspace } from "../../src/change/validation/createSnapshotWorkspace.js";
import { expectedSnapshotWorkspacePath } from "../../src/change/validation/snapshotWorkspacePath.js";
import { InfrastructureToolingFailed } from "../../src/change/validation/validationToolingFailures.js";
import { runDisposableExactCommitWorkspace } from "../../src/disposableWorkspace/runDisposableExactCommitWorkspace.js";
import { runTestProcess, runTestProcessOrThrow } from "../support/testProcess.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const validationRunId = "run-1";
const createSnapshotWorkspace = makeCreateSnapshotWorkspace(runDisposableExactCommitWorkspace);

describe("Snapshot Workspace lifecycle", () => {
  it.scoped("creates an exact detached worktree, executes commands, and removes it", () =>
    Effect.gen(function* () {
      const repository = initializedRepository();
      const commitSha = git(repository, "rev-parse", "HEAD");
      writeFileSync(join(repository, ".env.test"), "LOCAL_INPUT=yes\n");
      const worktreePath = expectedSnapshotWorkspacePath(repository, validationRunId);
      const cleanupResults: unknown[] = [];

      const result = yield* createSnapshotWorkspace({
        repoRoot: repository,
        validationRunId,
        submittedSha: commitSha,
        copyFiles: [".env.test"],
        recordWorkspaceCleanup: (cleanupResult) =>
          Effect.sync(() => {
            cleanupResults.push(cleanupResult);
          }),
        runInWorkspace: (workspace) =>
          Effect.gen(function* () {
            expect(gitStatus(workspace.worktreePath, "symbolic-ref", "-q", "HEAD")).toBe(1);
            const observed = yield* workspace.commandExecutor(
              'printf \'%s:%s\' "$(git rev-parse HEAD)" "$(cat .env.test)"',
            );
            expect(observed).toMatchObject({
              exitCode: 0,
              stdout: `${commitSha}:LOCAL_INPUT=yes`,
            });
            return { outcome: "passed" as const, toolingFailures: [] };
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
        activeWorkspaceResult: { outcome: "passed", toolingFailures: [] },
      });
      expect(cleanupResults).toEqual([{ workspace: "removed" }]);
      expect(existsSync(worktreePath)).toBe(false);
      expect(git(repository, "for-each-ref", "--format=%(refname)", "refs/but-why")).toBe("");
    }),
  );

  it.scoped("reuses only the same clean detached worktree at the exact commit", () =>
    Effect.gen(function* () {
      const repository = initializedRepository();
      const commitSha = git(repository, "rev-parse", "HEAD");
      const worktreePath = expectedSnapshotWorkspacePath(repository, validationRunId);
      mkdirSync(dirname(worktreePath), { recursive: true });
      git(repository, "worktree", "add", "--detach", "--", worktreePath, commitSha);

      const result = yield* createSnapshotWorkspace({
        repoRoot: repository,
        validationRunId,
        submittedSha: commitSha,
        copyFiles: [],
      });

      expect(result).toEqual({ ok: true });
      expect(existsSync(worktreePath)).toBe(false);
    }),
  );

  it.scoped("refuses a path whose Local Repository registration cannot be proved", () =>
    Effect.gen(function* () {
      const repository = initializedRepository();
      const commitSha = git(repository, "rev-parse", "HEAD");
      const worktreePath = expectedSnapshotWorkspacePath(repository, validationRunId);
      mkdirSync(worktreePath, { recursive: true });
      writeFileSync(join(worktreePath, "keep"), "unowned\n");
      const cleanupResults: unknown[] = [];

      const result = yield* createSnapshotWorkspace({
        repoRoot: repository,
        validationRunId,
        submittedSha: commitSha,
        copyFiles: [],
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
      expect(cleanupResults).toEqual([{ workspace: "failed" }]);
      expect(existsSync(join(worktreePath, "keep"))).toBe(true);
    }),
  );

  it.scoped("rejects a symbolic-link local workspace input", () =>
    Effect.gen(function* () {
      const repository = initializedRepository();
      const commitSha = git(repository, "rev-parse", "HEAD");
      writeFileSync(join(repository, "source"), "secret\n");
      symlinkSync("source", join(repository, ".env.test"));

      const result = yield* createSnapshotWorkspace({
        repoRoot: repository,
        validationRunId,
        submittedSha: commitSha,
        copyFiles: [".env.test"],
      });

      expect(result).toMatchObject({
        ok: false,
        toolingError: {
          operationName: "copy_allowlisted_file",
          cleanupResult: { workspace: "removed" },
        },
      });
    }),
  );

  it.scoped("does not follow a Candidate symbolic link while copying a local input", () =>
    Effect.gen(function* () {
      const repository = initializedRepository();
      writeFileSync(join(repository, "target"), "candidate target\n");
      symlinkSync("target", join(repository, ".env.test"));
      git(repository, "add", "target", ".env.test");
      git(repository, "commit", "-m", "Candidate symbolic link");
      const commitSha = git(repository, "rev-parse", "HEAD");
      unlinkSync(join(repository, ".env.test"));
      writeFileSync(join(repository, ".env.test"), "LOCAL_INPUT=yes\n");

      const result = yield* createSnapshotWorkspace({
        repoRoot: repository,
        validationRunId,
        submittedSha: commitSha,
        copyFiles: [".env.test"],
      });

      expect(result).toMatchObject({
        ok: false,
        toolingError: {
          operationName: "copy_allowlisted_file",
          errorMessage: "Snapshot Workspace file destination is a symbolic link: .env.test",
          cleanupResult: { workspace: "removed" },
        },
      });
      expect(readFileSync(join(repository, "target"), "utf8")).toBe("candidate target\n");
    }),
  );

  it.scoped("terminates an interrupted command before cleanup records success", () =>
    Effect.gen(function* () {
      const repository = initializedRepository();
      const commitSha = git(repository, "rev-parse", "HEAD");
      const worktreePath = expectedSnapshotWorkspacePath(repository, validationRunId);
      const evidenceRoot = createTestWorkspace();
      const processIdPath = join(evidenceRoot, "child-pid");
      const cleanupResults: unknown[] = [];
      const fiber = yield* Effect.fork(
        createSnapshotWorkspace({
          repoRoot: repository,
          validationRunId,
          submittedSha: commitSha,
          copyFiles: [],
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
                Effect.as({ outcome: "passed" as const, toolingFailures: [] }),
              ),
        }),
      );
      yield* Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            const interval = setInterval(() => {
              if (!existsSync(processIdPath)) return;
              clearInterval(interval);
              resolve();
            }, 5);
          }),
      );
      const childProcessId = readFileSync(processIdPath, "utf8");
      yield* Fiber.interrupt(fiber);

      expect(cleanupResults).toEqual([{ workspace: "removed" }]);
      expect(existsSync(worktreePath)).toBe(false);
      expect(runTestProcess("kill", ["-0", childProcessId], { cwd: repository }).status).not.toBe(
        0,
      );
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
  git(repository, "branch", "-M", "main");
  return repository;
};

const gitStatus = (cwd: string, ...args: readonly string[]): number =>
  runTestProcess("git", args, { cwd }).status ?? -1;

const git = (cwd: string, ...args: readonly string[]): string =>
  runTestProcessOrThrow("git", args, { cwd });
