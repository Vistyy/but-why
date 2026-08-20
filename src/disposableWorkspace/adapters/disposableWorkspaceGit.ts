import { accessSync, constants, lstatSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { Effect } from "effect";
import { executeHostCommandEffect } from "../../command/hostCommand.js";
import type { WorkspaceCommandExecutor } from "../../command/workspaceCommand.js";
import {
  type DisposableWorkspaceIdentity,
  DisposableWorkspaceRestorationFailed,
  type DisposableWorktreeInspection,
  type ExactDisposableWorkspaceCleanupInput,
  type ExactDisposableWorkspaceCleanupResult,
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

const verifyProductOwnedDisposableWorktree = (
  identity: DisposableWorkspaceIdentity,
): Effect.Effect<
  | {
      readonly ok: true;
      readonly worktreePath: string;
      readonly head: string | undefined;
      readonly detached: boolean;
    }
  | { readonly ok: false; readonly message: string }
> =>
  inspectProductOwnedDisposableWorktree(
    identity.repositoryRoot,
    identity.repositoryCommonDirectory,
    identity.workspaceId,
  ).pipe(
    Effect.map((inspection) =>
      inspection.state === "owned"
        ? {
            ok: true as const,
            worktreePath: inspection.worktreePath,
            head: inspection.record.head,
            detached: inspection.record.detached,
          }
        : {
            ok: false as const,
            message:
              inspection.state === "unproven"
                ? inspection.message
                : "Disposable Workspace is not registered.",
          },
    ),
  );

export const restoreDisposableWorkspace = (input: {
  readonly commandExecutor: WorkspaceCommandExecutor;
  readonly commandCwd: string;
  readonly expectedCommitSha: string;
  readonly workspaceIdentity?: DisposableWorkspaceIdentity;
}): Effect.Effect<void, DisposableWorkspaceRestorationFailed> =>
  Effect.gen(function* () {
    yield* verifyOwnedDetachedWorktree(input);
    yield* runRestorationCommand(
      input,
      `git reset --hard ${shellQuote(input.expectedCommitSha)} && git clean -fd -- .`,
    );
    yield* verifyOwnedDetachedWorktree(input, true);
    const clean = yield* runWorkspaceCommand(
      input,
      "git rev-parse HEAD && git diff --quiet && git diff --cached --quiet && git status --porcelain --untracked-files=all",
    );
    const [head, ...status] = clean.stdout.trimEnd().split("\n");
    if (head !== input.expectedCommitSha || status.length > 0) {
      return yield* restorationFailed("Disposable Workspace was not clean after restoration.");
    }
  });

const verifyOwnedDetachedWorktree = (
  input: {
    readonly commandExecutor: WorkspaceCommandExecutor;
    readonly commandCwd: string;
    readonly expectedCommitSha: string;
    readonly workspaceIdentity?: DisposableWorkspaceIdentity;
  },
  requireExpectedHead = false,
): Effect.Effect<void, DisposableWorkspaceRestorationFailed> =>
  Effect.gen(function* () {
    if (input.workspaceIdentity !== undefined) {
      const product = yield* verifyProductOwnedDisposableWorktree(input.workspaceIdentity);
      if (!product.ok) return yield* restorationFailed(product.message);
      if (resolve(product.worktreePath) !== resolve(input.commandCwd) || !product.detached) {
        return yield* restorationFailed(
          "Disposable Workspace ownership or detached state could not be verified.",
        );
      }
      const activeCommonDirectory = yield* runWorkspaceCommand(
        input,
        "git rev-parse --path-format=absolute --git-common-dir",
      );
      if (
        activeCommonDirectory.exitCode !== 0 ||
        resolve(activeCommonDirectory.stdout.trim()) !==
          resolve(input.workspaceIdentity.repositoryCommonDirectory)
      ) {
        return yield* restorationFailed(
          "Disposable Workspace Git Common Directory does not match its owned repository.",
        );
      }
      if (requireExpectedHead && product.head !== input.expectedCommitSha) {
        return yield* restorationFailed(
          "Disposable Workspace registration does not match the expected commit after restoration.",
        );
      }
    }
    const listed = yield* runWorkspaceCommand(input, "git worktree list --porcelain");
    const worktree = parseWorktreeRecords(listed.stdout).find(
      (record) => resolve(record.path) === resolve(input.commandCwd),
    );
    if (worktree === undefined || !worktree.detached) {
      return yield* restorationFailed(
        "Disposable Workspace ownership or detached state could not be verified.",
      );
    }
    if (requireExpectedHead && worktree.head !== input.expectedCommitSha) {
      return yield* restorationFailed(
        "Disposable Workspace registration does not match the expected commit after restoration.",
      );
    }
    const topLevel = yield* runWorkspaceCommand(input, "git rev-parse --show-toplevel");
    if (resolve(topLevel.stdout.trim()) !== resolve(input.commandCwd)) {
      return yield* restorationFailed(
        "Disposable Workspace path does not match the registered worktree.",
      );
    }
    const symbolicHead = yield* runWorkspaceCommand(input, "git symbolic-ref --quiet HEAD");
    if (symbolicHead.exitCode === 0 || symbolicHead.exitCode !== 1) {
      return yield* restorationFailed("Disposable Workspace HEAD is not detached.");
    }
  });

const runRestorationCommand = (
  input: {
    readonly commandExecutor: WorkspaceCommandExecutor;
    readonly commandCwd: string;
  },
  command: string,
): Effect.Effect<void, DisposableWorkspaceRestorationFailed> =>
  Effect.gen(function* () {
    const result = yield* runWorkspaceCommand(input, command);
    if (result.exitCode !== 0) {
      return yield* restorationFailed(
        [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n") ||
          "Disposable Workspace restoration failed.",
      );
    }
  });

const runWorkspaceCommand = (
  input: {
    readonly commandExecutor: WorkspaceCommandExecutor;
    readonly commandCwd: string;
  },
  command: string,
): Effect.Effect<
  { readonly exitCode: number; readonly stdout: string; readonly stderr: string },
  DisposableWorkspaceRestorationFailed
> =>
  input.commandExecutor(command, { cwd: input.commandCwd }).pipe(
    Effect.mapError(
      (error) =>
        new DisposableWorkspaceRestorationFailed({
          message: error.message,
        }),
    ),
  );

const restorationFailed = (
  message: string,
): Effect.Effect<never, DisposableWorkspaceRestorationFailed> =>
  Effect.fail(new DisposableWorkspaceRestorationFailed({ message }));

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export const inspectDisposableWorktree = (
  repositoryRoot: string,
  repositoryCommonDirectory: string,
  workspaceId: string,
  expectedCommitSha: string,
): Effect.Effect<DisposableWorktreeInspection> =>
  Effect.gen(function* () {
    const owned = yield* inspectProductOwnedDisposableWorktree(
      repositoryRoot,
      repositoryCommonDirectory,
      workspaceId,
    );
    if (owned.state === "absent") return owned;
    if (owned.state === "unproven") return owned;
    if (owned.record.head !== expectedCommitSha) {
      return {
        state: "unproven",
        message: "Live Snapshot Workspace identity does not match the expected workspace identity.",
      } as const;
    }
    const liveHead = yield* git(owned.worktreePath, ["rev-parse", "HEAD"]);
    if (!liveHead.ok || liveHead.stdout.trim() !== expectedCommitSha) {
      return {
        state: "unproven",
        message: "Live Snapshot Workspace HEAD does not match the expected commit.",
      } as const;
    }
    const status = yield* git(owned.worktreePath, ["status", "--porcelain=v1"]);
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
      owned.worktreePath,
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
  | { readonly state: "owned"; readonly record: WorktreeRecord; readonly worktreePath: string }
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
    const record = matches[0];
    if (!record?.detached || !isSafeWorktreeDirectory(worktreePath)) {
      return {
        state: "unproven",
        message: "Snapshot Workspace ownership cannot be proven.",
      } as const;
    }
    return { state: "owned", record, worktreePath } as const;
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
