import { accessSync, constants, copyFileSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { Effect } from "effect";
import { executeHostCommandEffect } from "../command/hostCommand.js";
import type { DisposableWorkspaceCleanupResult } from "./disposableWorkspace.js";
import {
  disposableWorkspaceRoot,
  expectedDisposableWorkspacePath,
  isExpectedDisposableWorkspacePath,
} from "./disposableWorkspacePath.js";

export type DisposableWorktreeInspection =
  | { readonly state: "absent" }
  | { readonly state: "matching"; readonly dirty: boolean }
  | { readonly state: "unproven"; readonly message: string };

export type ExactDisposableWorkspaceCleanupInput = {
  readonly workspaceId: string;
  readonly expectedCommitSha: string;
  readonly recordedWorktreePath?: string;
};

export type ExactDisposableWorkspaceCleanupResult = DisposableWorkspaceCleanupResult & {
  readonly errorMessage?: string;
};

export const prepareDisposableWorkspaceParent = (
  mainCheckoutRoot: string,
): Effect.Effect<{ readonly ok: true } | { readonly ok: false; readonly message: string }> =>
  Effect.sync(() => {
    const root = disposableWorkspaceRoot(mainCheckoutRoot);
    const containers = [dirname(dirname(root)), dirname(root), root];
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

export const inspectDisposableWorktree = (
  mainCheckoutRoot: string,
  workspaceId: string,
  expectedCommitSha: string,
  worktreePath: string,
): Effect.Effect<DisposableWorktreeInspection> =>
  Effect.gen(function* () {
    if (!isExpectedDisposableWorkspacePath(mainCheckoutRoot, workspaceId, worktreePath)) {
      return {
        state: "unproven",
        message: "Recorded Snapshot Workspace identity does not match its selected Validation Run.",
      } as const;
    }
    const records = yield* readWorktreeRecords(mainCheckoutRoot);
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
        message: "Live Snapshot Workspace identity does not match its selected Validation Run.",
      } as const;
    }
    const liveHead = yield* git(worktreePath, ["rev-parse", "HEAD"]);
    if (!liveHead.ok || liveHead.stdout.trim() !== expectedCommitSha) {
      return {
        state: "unproven",
        message: "Live Snapshot Workspace HEAD does not match its selected Validation Run.",
      } as const;
    }
    const status = yield* git(worktreePath, ["status", "--porcelain=v1"]);
    if (!status.ok) return { state: "unproven", message: status.message } as const;
    return { state: "matching", dirty: status.stdout.length > 0 } as const;
  });

export const createDetachedDisposableWorktree = (
  mainCheckoutRoot: string,
  worktreePath: string,
  commitSha: string,
): Effect.Effect<{ readonly ok: true } | { readonly ok: false; readonly message: string }> =>
  git(mainCheckoutRoot, ["worktree", "add", "--detach", "--", worktreePath, commitSha]).pipe(
    Effect.map((result) => (result.ok ? { ok: true as const } : result)),
  );

export const copyDisposableWorkspaceFiles = (
  mainCheckoutRoot: string,
  worktreePath: string,
  copyFiles: readonly string[],
): Effect.Effect<{ readonly ok: true } | { readonly ok: false; readonly message: string }> =>
  Effect.sync(() => {
    try {
      for (const path of copyFiles) {
        const source = resolve(mainCheckoutRoot, path);
        const destination = resolve(worktreePath, path);
        if (
          !isPathInside(mainCheckoutRoot, source) ||
          !isRegularContainedFile(mainCheckoutRoot, source) ||
          !isPathInside(worktreePath, destination)
        ) {
          return {
            ok: false as const,
            message: `Allowlisted workspace file is not a regular repo-relative file: ${path}`,
          };
        }
        const safeParent = ensureSafeDestinationParent(worktreePath, dirname(destination));
        if (!safeParent.ok) return safeParent;
        if (pathExists(destination) && lstatSync(destination).isSymbolicLink()) {
          return {
            ok: false as const,
            message: `Snapshot Workspace file destination is a symbolic link: ${path}`,
          };
        }
        copyFileSync(source, destination);
      }
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, message: errorMessage(error) };
    }
  });

export const cleanupExactDisposableWorkspace = (
  mainCheckoutRoot: string,
  input: ExactDisposableWorkspaceCleanupInput,
): Effect.Effect<ExactDisposableWorkspaceCleanupResult> =>
  Effect.gen(function* () {
    const expectedWorktreePath = expectedDisposableWorkspacePath(
      mainCheckoutRoot,
      input.workspaceId,
    );
    if (
      input.recordedWorktreePath === undefined ||
      !isExpectedDisposableWorkspacePath(
        mainCheckoutRoot,
        input.workspaceId,
        input.recordedWorktreePath,
      )
    ) {
      return cleanupFailed(
        "Recorded Snapshot Workspace identity does not match its selected Validation Run.",
      );
    }
    const parent = yield* inspectSafeWorkspaceContainers(mainCheckoutRoot);
    if (!parent.ok) return cleanupFailed(parent.message);

    const inspected = yield* inspectDisposableWorktree(
      mainCheckoutRoot,
      input.workspaceId,
      input.expectedCommitSha,
      expectedWorktreePath,
    );
    if (inspected.state === "absent") return { workspace: "removed" } as const;
    if (inspected.state === "unproven") return cleanupFailed(inspected.message);

    const removed = yield* git(mainCheckoutRoot, [
      "worktree",
      "remove",
      "--force",
      "--",
      expectedWorktreePath,
    ]);
    const verified = yield* inspectDisposableWorktree(
      mainCheckoutRoot,
      input.workspaceId,
      input.expectedCommitSha,
      expectedWorktreePath,
    );
    if (verified.state === "absent") return { workspace: "removed" } as const;
    return cleanupFailed(
      removed.ok ? "Exact Snapshot Workspace cleanup did not complete." : removed.message,
    );
  });

const inspectSafeWorkspaceContainers = (
  mainCheckoutRoot: string,
): Effect.Effect<{ readonly ok: true } | { readonly ok: false; readonly message: string }> =>
  Effect.sync(() => {
    try {
      const root = disposableWorkspaceRoot(mainCheckoutRoot);
      for (const container of [dirname(dirname(root)), dirname(root), root]) {
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
  readonly detached: boolean;
};

const readWorktreeRecords = (
  mainCheckoutRoot: string,
): Effect.Effect<
  | { readonly ok: true; readonly records: readonly WorktreeRecord[] }
  | { readonly ok: false; readonly message: string }
> =>
  git(mainCheckoutRoot, ["worktree", "list", "--porcelain"]).pipe(
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
      return path === undefined
        ? undefined
        : {
            path,
            ...(head === undefined ? {} : { head }),
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

const isRegularContainedFile = (root: string, path: string): boolean => {
  try {
    return lstatSync(path).isFile() && isPathInside(realpathSync(root), realpathSync(path));
  } catch {
    return false;
  }
};

const ensureSafeDestinationParent = (
  worktreePath: string,
  destinationParent: string,
): { readonly ok: true } | { readonly ok: false; readonly message: string } => {
  let current = resolve(worktreePath);
  for (const part of relative(current, destinationParent).split(sep).filter(Boolean)) {
    current = join(current, part);
    if (!pathExists(current)) mkdirSync(current);
    const entry = lstatSync(current);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      return {
        ok: false,
        message: `Snapshot Workspace file parent is not a safe directory: ${current}`,
      };
    }
  }
  return { ok: true };
};

const isPathInside = (root: string, path: string): boolean => {
  const relativePath = relative(resolve(root), resolve(path));
  return relativePath.length > 0 && relativePath !== ".." && !relativePath.startsWith(`..${sep}`);
};

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
