import { accessSync, constants, lstatSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { Effect } from "effect";
import { executeHostCommandEffect } from "../../command/hostCommand.js";
import type {
  DisposableWorktreeInspection,
  ExactDisposableWorkspaceCleanupInput,
  ExactDisposableWorkspaceCleanupResult,
} from "../disposableWorkspace.js";
import {
  disposableWorkspaceRoot,
  expectedDisposableWorkspacePath,
  isExpectedDisposableWorkspacePath,
} from "../disposableWorkspacePath.js";

export const prepareDisposableWorkspaceParent = (
  repositoryRoot: string,
  repositoryCommonDirectory: string,
): Effect.Effect<{ readonly ok: true } | { readonly ok: false; readonly message: string }> =>
  Effect.gen(function* () {
    const identity = yield* verifyRepositoryCommonDirectory(
      repositoryRoot,
      repositoryCommonDirectory,
    );
    if (!identity.ok) return identity;
    return yield* Effect.sync(() => {
      const root = disposableWorkspaceRoot(repositoryCommonDirectory);
      const containers = [dirname(root), root];
      try {
        for (const container of containers) {
          if (!pathExists(container)) mkdirSync(container);
          const entry = lstatSync(container);
          if (!entry.isDirectory() || entry.isSymbolicLink()) {
            return {
              ok: false as const,
              message: `Snapshot Workspace container is not a safe directory: ${container}`,
            };
          }
        }
        accessSync(root, constants.W_OK | constants.X_OK);
        return { ok: true as const };
      } catch (error) {
        return { ok: false as const, message: errorMessage(error) };
      }
    });
  });

export const inspectDisposableWorktree = (
  repositoryRoot: string,
  repositoryCommonDirectory: string,
  workspaceId: string,
  expectedCommitSha: string,
): Effect.Effect<DisposableWorktreeInspection> =>
  Effect.gen(function* () {
    const identity = yield* verifyRepositoryCommonDirectory(
      repositoryRoot,
      repositoryCommonDirectory,
    );
    if (!identity.ok) return { state: "unproven", message: identity.message } as const;
    const worktreePath = expectedDisposableWorkspacePath(repositoryCommonDirectory, workspaceId);
    if (!isExpectedDisposableWorkspacePath(repositoryCommonDirectory, workspaceId, worktreePath)) {
      return {
        state: "unproven",
        message: "Derived Snapshot Workspace identity is invalid.",
      } as const;
    }
    const containers = yield* inspectSafeWorkspaceContainers(repositoryCommonDirectory);
    if (!containers.ok) return { state: "unproven", message: containers.message } as const;
    const records = yield* readWorktreeRecords(repositoryRoot);
    if (!records.ok) return { state: "unproven", message: records.message } as const;
    const matches = records.records.filter(
      (record) => resolve(record.path) === resolve(worktreePath),
    );
    if (matches.length === 0) {
      return pathExists(worktreePath)
        ? ({
            state: "unproven",
            message: "Snapshot Workspace path exists without a Local Repository registration.",
          } as const)
        : ({ state: "absent" } as const);
    }
    if (matches.length !== 1) {
      return {
        state: "unproven",
        message: "Snapshot Workspace registration is not unique.",
      } as const;
    }
    const record = matches[0];
    if (
      record?.head !== expectedCommitSha ||
      !record.detached ||
      !isSafeWorktreeDirectory(worktreePath)
    ) {
      return {
        state: "unproven",
        message: "Live Snapshot Workspace identity does not match the expected workspace identity.",
      } as const;
    }
    const liveHead = yield* git(worktreePath, ["rev-parse", "HEAD"]);
    if (!liveHead.ok || liveHead.stdout.trim() !== expectedCommitSha) {
      return {
        state: "unproven",
        message: "Live Snapshot Workspace HEAD does not match the expected commit.",
      } as const;
    }
    const status = yield* git(worktreePath, ["status", "--porcelain=v1"]);
    if (!status.ok) return { state: "unproven", message: status.message } as const;
    return { state: "matching", dirty: status.stdout.length > 0 } as const;
  });

export const createDetachedDisposableWorktree = (
  repositoryRoot: string,
  worktreePath: string,
  commitSha: string,
): Effect.Effect<{ readonly ok: true } | { readonly ok: false; readonly message: string }> =>
  git(repositoryRoot, ["worktree", "add", "--detach", "--", worktreePath, commitSha]).pipe(
    Effect.map((result) => (result.ok ? { ok: true as const } : result)),
  );

export const cleanupExactDisposableWorkspace = (
  repositoryRoot: string,
  repositoryCommonDirectory: string,
  input: ExactDisposableWorkspaceCleanupInput,
): Effect.Effect<ExactDisposableWorkspaceCleanupResult> =>
  Effect.gen(function* () {
    const identity = yield* verifyRepositoryCommonDirectory(
      repositoryRoot,
      repositoryCommonDirectory,
    );
    if (!identity.ok) return cleanupFailed(identity.message);
    const expectedWorktreePath = expectedDisposableWorkspacePath(
      repositoryCommonDirectory,
      input.workspaceId,
    );
    if (
      !isExpectedDisposableWorkspacePath(
        repositoryCommonDirectory,
        input.workspaceId,
        expectedWorktreePath,
      )
    ) {
      return cleanupFailed("Derived Snapshot Workspace identity is invalid.");
    }
    const parent = yield* inspectSafeWorkspaceContainers(repositoryCommonDirectory);
    if (!parent.ok) return cleanupFailed(parent.message);

    const owned = yield* inspectProductOwnedDisposableWorktree(
      repositoryRoot,
      repositoryCommonDirectory,
      input.workspaceId,
    );
    if (owned.state === "absent") return { workspace: "removed" } as const;
    if (owned.state === "unproven") return cleanupFailed(owned.message);

    const removed = yield* git(repositoryRoot, [
      "worktree",
      "remove",
      "--force",
      "--",
      expectedWorktreePath,
    ]);
    const verified = yield* inspectDisposableWorktree(
      repositoryRoot,
      repositoryCommonDirectory,
      input.workspaceId,
      input.expectedCommitSha,
    );
    if (verified.state === "absent") return { workspace: "removed" } as const;
    return cleanupFailed(
      removed.ok ? "Exact Snapshot Workspace cleanup did not complete." : removed.message,
    );
  });

type ProductOwnedDisposableWorktreeInspection =
  | { readonly state: "absent" }
  | { readonly state: "owned" }
  | { readonly state: "unproven"; readonly message: string };

const inspectProductOwnedDisposableWorktree = (
  repositoryRoot: string,
  repositoryCommonDirectory: string,
  workspaceId: string,
): Effect.Effect<ProductOwnedDisposableWorktreeInspection> =>
  Effect.gen(function* () {
    const identity = yield* verifyRepositoryCommonDirectory(
      repositoryRoot,
      repositoryCommonDirectory,
    );
    if (!identity.ok) return { state: "unproven", message: identity.message } as const;
    const worktreePath = expectedDisposableWorkspacePath(repositoryCommonDirectory, workspaceId);
    if (!isExpectedDisposableWorkspacePath(repositoryCommonDirectory, workspaceId, worktreePath)) {
      return {
        state: "unproven",
        message: "Derived Snapshot Workspace identity is invalid.",
      } as const;
    }
    const containers = yield* inspectSafeWorkspaceContainers(repositoryCommonDirectory);
    if (!containers.ok) return { state: "unproven", message: containers.message } as const;
    const records = yield* readWorktreeRecords(repositoryRoot);
    if (!records.ok) return { state: "unproven", message: records.message } as const;
    const matches = records.records.filter(
      (record) => resolve(record.path) === resolve(worktreePath),
    );
    if (matches.length === 0) {
      return pathExists(worktreePath)
        ? ({
            state: "unproven",
            message: "Snapshot Workspace path exists without a Local Repository registration.",
          } as const)
        : ({ state: "absent" } as const);
    }
    if (matches.length !== 1) {
      return {
        state: "unproven",
        message: "Snapshot Workspace registration is not unique.",
      } as const;
    }
    if (!matches[0]?.detached || !isSafeWorktreeDirectory(worktreePath)) {
      return {
        state: "unproven",
        message: "Snapshot Workspace ownership cannot be proven.",
      } as const;
    }
    return { state: "owned" } as const;
  });

const verifyRepositoryCommonDirectory = (
  repositoryRoot: string,
  repositoryCommonDirectory: string,
): Effect.Effect<{ readonly ok: true } | { readonly ok: false; readonly message: string }> =>
  git(repositoryRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).pipe(
    Effect.map((result) => {
      if (!result.ok) return result;
      const actual = resolve(result.stdout.trim());
      const expected = resolve(repositoryCommonDirectory);
      return actual === expected
        ? ({ ok: true } as const)
        : ({
            ok: false,
            message: `Local Repository Git Common Directory does not match Shared Repository State. Expected ${expected}; received ${actual}.`,
          } as const);
    }),
  );

const inspectSafeWorkspaceContainers = (
  repositoryCommonDirectory: string,
): Effect.Effect<{ readonly ok: true } | { readonly ok: false; readonly message: string }> =>
  Effect.sync(() => {
    try {
      const root = disposableWorkspaceRoot(repositoryCommonDirectory);
      for (const container of [dirname(root), root]) {
        if (!pathExists(container)) continue;
        const entry = lstatSync(container);
        if (!entry.isDirectory() || entry.isSymbolicLink()) {
          return {
            ok: false as const,
            message: `Snapshot Workspace container identity is unsafe: ${container}`,
          };
        }
      }
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, message: errorMessage(error) };
    }
  });

const cleanupFailed = (errorMessage: string): ExactDisposableWorkspaceCleanupResult => ({
  workspace: "failed",
  errorMessage,
});

type WorktreeRecord = {
  readonly path: string;
  readonly head?: string;
  readonly branch?: string;
  readonly detached: boolean;
};

const readWorktreeRecords = (
  repositoryRoot: string,
): Effect.Effect<
  | { readonly ok: true; readonly records: readonly WorktreeRecord[] }
  | { readonly ok: false; readonly message: string }
> =>
  git(repositoryRoot, ["worktree", "list", "--porcelain"]).pipe(
    Effect.map((result) =>
      result.ok ? { ok: true as const, records: parseWorktreeRecords(result.stdout) } : result,
    ),
  );

const parseWorktreeRecords = (porcelain: string): readonly WorktreeRecord[] =>
  porcelain
    .trim()
    .split(/\n\n+/)
    .map((entry) => {
      const lines = entry.split("\n");
      const path = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
      const head = lines.find((line) => line.startsWith("HEAD "))?.slice("HEAD ".length);
      const branch = lines.find((line) => line.startsWith("branch "))?.slice("branch ".length);
      return path === undefined
        ? undefined
        : {
            path,
            ...(head === undefined ? {} : { head }),
            ...(branch === undefined ? {} : { branch }),
            detached: lines.includes("detached"),
          };
    })
    .filter((record): record is WorktreeRecord => record !== undefined);

type GitResult =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly message: string };

const git = (cwd: string, args: readonly string[]): Effect.Effect<GitResult> =>
  executeHostCommandEffect({ command: "git", args, cwd }).pipe(
    Effect.map((result) =>
      result.exitCode === 0
        ? { ok: true as const, stdout: result.stdout }
        : {
            ok: false as const,
            message: [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n"),
          },
    ),
    Effect.catchAll((error) =>
      Effect.succeed({ ok: false as const, message: errorMessage(error) }),
    ),
  );

const isSafeWorktreeDirectory = (path: string): boolean => {
  try {
    const entry = lstatSync(path);
    return entry.isDirectory() && !entry.isSymbolicLink();
  } catch {
    return false;
  }
};

const pathExists = (path: string): boolean => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
