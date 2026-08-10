import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { DisposableWorkspaceCleanupState } from "./disposableWorkspace.js";

const zeroSha = "0000000000000000000000000000000000000000";
const workspaceGitOperationTimeoutMs = 30_000;

export const ensureDisposableWorkspaceRef = (
  repoRoot: string,
  tempRefName: string,
  submittedSha: string,
): { readonly ok: true } | { readonly ok: false; readonly message: string } => {
  const existing = git(repoRoot, ["rev-parse", "--verify", `${tempRefName}^{commit}`]);

  if (existing.ok) {
    const existingSha = existing.stdout.trim();

    if (existingSha === submittedSha) {
      return { ok: true };
    }

    return {
      ok: false,
      message: `Disposable workspace ref ${tempRefName} already points to ${existingSha}, not ${submittedSha}.`,
    };
  }

  const created = git(repoRoot, ["update-ref", "--no-deref", tempRefName, submittedSha, zeroSha]);

  if (created.ok) {
    return { ok: true };
  }

  const raced = git(repoRoot, ["rev-parse", "--verify", `${tempRefName}^{commit}`]);

  if (raced.ok && raced.stdout.trim() === submittedSha) {
    return { ok: true };
  }

  return { ok: false, message: created.message };
};

export const inspectExistingWorktree = (
  worktreePath: string,
):
  | { readonly exists: false }
  | {
      readonly exists: true;
      readonly branch: string | undefined;
      readonly head: string | undefined;
      readonly dirty: boolean;
    } => {
  if (!existsSync(worktreePath)) {
    return { exists: false };
  }

  const branch = git(worktreePath, ["rev-parse", "--symbolic-full-name", "HEAD"]);
  const head = git(worktreePath, ["rev-parse", "HEAD"]);
  const status = git(worktreePath, ["status", "--porcelain=v1"]);

  return {
    exists: true,
    branch: branch.ok ? branch.stdout.trim() : undefined,
    head: head.ok ? head.stdout.trim() : undefined,
    dirty: !status.ok || status.stdout.trim().length > 0,
  };
};

export const removeDisposableWorktree = (repoRoot: string, worktreePath: string): boolean => {
  git(repoRoot, ["worktree", "remove", "--force", worktreePath]);

  return isDisposableWorktreeRemoved(repoRoot, worktreePath);
};

export const isDisposableWorktreeRemoved = (repoRoot: string, worktreePath: string): boolean => {
  if (existsSync(worktreePath)) return false;

  const worktrees = git(repoRoot, ["worktree", "list", "--porcelain"]);
  if (!worktrees.ok) return false;

  return !worktreePaths(worktrees.stdout).includes(resolve(worktreePath));
};

const worktreePaths = (porcelain: string): readonly string[] =>
  porcelain
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => resolve(line.slice("worktree ".length)));

export const deleteDisposableWorkspaceRef = (
  repoRoot: string,
  tempRefName: string,
): DisposableWorkspaceCleanupState => {
  const result = git(repoRoot, ["update-ref", "-d", tempRefName]);

  if (result.ok) {
    return "removed";
  }

  return git(repoRoot, ["rev-parse", "--verify", `${tempRefName}^{commit}`]).ok
    ? "failed"
    : "removed";
};

export type ExactDisposableWorkspaceCleanupInput = {
  readonly expectedTempRefName: string;
  readonly expectedWorktreePath: string;
  readonly expectedCommitSha: string;
  readonly recordedTempRefName?: string;
  readonly recordedWorktreePath?: string;
};

export type ExactDisposableWorkspaceCleanupResult = {
  readonly worktree: DisposableWorkspaceCleanupState;
  readonly tempRef: DisposableWorkspaceCleanupState;
  readonly errorMessage?: string;
};

export const cleanupExactDisposableWorkspace = (
  repoRoot: string,
  input: ExactDisposableWorkspaceCleanupInput,
): ExactDisposableWorkspaceCleanupResult => {
  if (
    input.recordedTempRefName !== input.expectedTempRefName ||
    input.recordedWorktreePath === undefined ||
    resolve(input.recordedWorktreePath) !== resolve(input.expectedWorktreePath)
  ) {
    return {
      worktree: "failed",
      tempRef: "failed",
      errorMessage:
        "Recorded Validation Workspace identity does not match its selected Validation Run.",
    };
  }

  const tempRef = inspectExactTempRef(repoRoot, input.expectedTempRefName, input.expectedCommitSha);
  const worktree = inspectExactWorktree(repoRoot, input);
  if (tempRef === "failed" || worktree === "failed") {
    return {
      worktree: worktree === "ready" ? "failed" : worktree,
      tempRef: tempRef === "ready" ? "failed" : tempRef,
      errorMessage:
        "Live Validation Workspace identity does not match its selected Validation Run.",
    };
  }

  const cleanedWorktree =
    worktree === "removed"
      ? "removed"
      : removeDisposableWorktree(repoRoot, input.expectedWorktreePath)
        ? "removed"
        : "failed";
  const cleanedTempRef =
    tempRef === "removed"
      ? "removed"
      : deleteExactDisposableWorkspaceRef(
          repoRoot,
          input.expectedTempRefName,
          input.expectedCommitSha,
        );

  return {
    worktree: cleanedWorktree,
    tempRef: cleanedTempRef,
    ...(cleanedWorktree === "failed" || cleanedTempRef === "failed"
      ? { errorMessage: "Exact Validation Workspace cleanup did not complete." }
      : {}),
  };
};

type ExactResourceState = "ready" | DisposableWorkspaceCleanupState;

const inspectExactTempRef = (
  repoRoot: string,
  tempRefName: string,
  expectedCommitSha: string,
): ExactResourceState => {
  const inspected = git(repoRoot, [
    "for-each-ref",
    "--format=%(refname) %(objectname)",
    "--",
    tempRefName,
  ]);
  if (!inspected.ok) return "failed";

  const matching = inspected.stdout
    .trim()
    .split("\n")
    .filter((line) => line.startsWith(`${tempRefName} `));
  if (matching.length === 0) return "removed";
  return matching.length === 1 && matching[0] === `${tempRefName} ${expectedCommitSha}`
    ? "ready"
    : "failed";
};

const inspectExactWorktree = (
  repoRoot: string,
  input: ExactDisposableWorkspaceCleanupInput,
): ExactResourceState => {
  const inspected = git(repoRoot, ["worktree", "list", "--porcelain"]);
  if (!inspected.ok) return "failed";

  const expectedPath = resolve(input.expectedWorktreePath);
  const matching = worktreeRecords(inspected.stdout).filter(
    (record) => resolve(record.path) === expectedPath,
  );
  if (matching.length === 0) {
    return existsSync(input.expectedWorktreePath) ? "failed" : "removed";
  }
  if (matching.length !== 1) return "failed";

  const [record] = matching;
  return record?.head === input.expectedCommitSha &&
    (record.branch === input.expectedTempRefName || record.detached === true)
    ? "ready"
    : "failed";
};

const worktreeRecords = (
  porcelain: string,
): readonly {
  readonly path: string;
  readonly head?: string;
  readonly branch?: string;
  readonly detached: boolean;
}[] =>
  porcelain
    .trim()
    .split(/\n\n+/)
    .map((entry) => {
      const fields = new Map(
        entry.split("\n").map((line) => {
          const separator = line.indexOf(" ");
          return separator === -1
            ? ([line, ""] as const)
            : ([line.slice(0, separator), line.slice(separator + 1)] as const);
        }),
      );
      const head = fields.get("HEAD");
      const branch = fields.get("branch");
      return {
        path: fields.get("worktree") ?? "",
        ...(head === undefined ? {} : { head }),
        ...(branch === undefined ? {} : { branch }),
        detached: fields.has("detached"),
      };
    })
    .filter((record) => record.path.length > 0);

const deleteExactDisposableWorkspaceRef = (
  repoRoot: string,
  tempRefName: string,
  expectedCommitSha: string,
): DisposableWorkspaceCleanupState => {
  const result = git(repoRoot, ["update-ref", "-d", tempRefName, expectedCommitSha]);
  if (result.ok) return "removed";

  return inspectExactTempRef(repoRoot, tempRefName, expectedCommitSha) === "removed"
    ? "removed"
    : "failed";
};

type GitResult =
  | {
      readonly ok: true;
      readonly stdout: string;
    }
  | {
      readonly ok: false;
      readonly message: string;
    };

const git = (cwd: string, args: readonly string[]): GitResult => {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: workspaceGitOperationTimeoutMs,
  });

  if (result.status === 0) {
    return { ok: true, stdout: result.stdout };
  }

  return {
    ok: false,
    message: [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n"),
  };
};
