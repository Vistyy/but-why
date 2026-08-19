import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import type { LocalRepositoryContext } from "../../repositoryRuntime/repositoryContext.js";
import { fetchRemoteChangeBase } from "../../submissionEnvironment/adapters/remoteChangeBase.js";
import type {
  ProvisionChangeWorktreeResult,
  ResolveChangeStartGitResult,
} from "../changeStartGitOperations.js";
import type { ChangeStartRecord } from "../changeStartStore.js";

export const resolveChangeStartGitIntent = (
  context: LocalRepositoryContext,
  requestedBaseBranch?: string,
): ResolveChangeStartGitResult => {
  const fetched = fetchRemoteChangeBase(context.root, requestedBaseBranch);
  if (!fetched.ok) return fetched;
  const baseRef = fetched.base.ref;
  const startingCommit = fetched.base.commit;

  return {
    ok: true,
    intent: {
      baseRef,
      baseRemoteUrl: fetched.base.remoteUrl,
      startingCommit,
      managedWorktreeParent: join(
        dirname(context.root),
        `${basename(context.root)}-worktrees`,
        "but-why",
      ),
    },
  };
};

export const provisionChangeWorktree = (
  cwd: string,
  start: ChangeStartRecord,
  recovering: boolean,
  startingCommit?: string,
): ProvisionChangeWorktreeResult => {
  const worktreesResult = git(cwd, "worktree", "list", "--porcelain");
  if (!worktreesResult.ok) return { ok: false, code: "git_tooling_error" };

  const branch = ensureRecordedBranch(cwd, start, recovering, startingCommit);
  if (!branch.ok) return branch;

  const worktree = inspectRecordedWorktree(start, parseWorktrees(worktreesResult.stdout));
  if (worktree !== "missing" && worktree !== "stale") return worktree;
  if (worktree === "stale") {
    const removed = removeStaleWorktreeRegistration(cwd, start);
    if (!removed.ok) return removed;
  }
  return addRecordedWorktree(cwd, start);
};

const inspectRecordedWorktree = (
  start: ChangeStartRecord,
  worktrees: readonly WorktreeEntry[],
): ProvisionChangeWorktreeResult | "missing" | "stale" => {
  if (!managedWorktreeContainersAreSafe(start.worktreePath)) {
    return {
      ok: false,
      code: "managed_worktree_path_unavailable",
      path: start.worktreePath,
    };
  }
  const expectedPath = canonicalPathIfPresent(start.worktreePath);
  const listedAtPath = worktrees.find((entry) => entry.path === expectedPath);
  const listedForBranch = worktrees.find((entry) => entry.branchRef === start.branchRef);
  if (!pathEntryExists(start.worktreePath)) {
    if (listedAtPath === undefined && listedForBranch === undefined) return "missing";
    if (
      listedAtPath !== undefined &&
      listedAtPath.branchRef === start.branchRef &&
      listedAtPath.prunable &&
      listedForBranch === listedAtPath
    ) {
      return "stale";
    }
    if (listedForBranch !== undefined) {
      return {
        ok: false,
        code: "managed_branch_attached",
        branch: start.branchRef,
        path: start.worktreePath,
        attachedPath: listedForBranch.path,
      };
    }
    return { ok: false, code: "change_start_conflict" };
  }
  if (lstatSync(start.worktreePath).isSymbolicLink()) {
    return {
      ok: false,
      code: "managed_worktree_path_unavailable",
      path: start.worktreePath,
    };
  }
  if (listedAtPath === undefined || listedAtPath.prunable) {
    return {
      ok: false,
      code: "managed_worktree_path_conflict",
      branch: start.branchRef,
      path: start.worktreePath,
    };
  }
  return listedAtPath.branchRef === start.branchRef && listedForBranch?.path === expectedPath
    ? { ok: true }
    : { ok: false, code: "change_start_conflict" };
};

const ensureRecordedBranch = (
  cwd: string,
  start: ChangeStartRecord,
  recovering: boolean,
  startingCommit: string | undefined,
): ProvisionChangeWorktreeResult => {
  const branch = inspectRecordedBranch(cwd, start.branchRef);
  if (branch === "present") {
    return recovering ? { ok: true } : { ok: false, code: "change_start_conflict" };
  }
  if (branch === "tooling_error") return { ok: false, code: "git_tooling_error" };
  if (recovering) {
    return {
      ok: false,
      code: "managed_branch_missing",
      branch: start.branchRef,
      path: start.worktreePath,
    };
  }
  if (startingCommit === undefined) return { ok: false, code: "git_tooling_error" };
  const branchName = start.branchRef.slice("refs/heads/".length);
  const create = git(cwd, "branch", branchName, startingCommit);
  return create.ok ? { ok: true } : { ok: false, code: "git_tooling_error" };
};

const inspectRecordedBranch = (
  cwd: string,
  branchRef: string,
): "present" | "missing" | "tooling_error" => {
  const exists = git(cwd, "show-ref", "--verify", "--quiet", branchRef);
  if (!exists.ok) return exists.status === 1 ? "missing" : "tooling_error";
  return git(cwd, "rev-parse", "--verify", `${branchRef}^{commit}`).ok
    ? "present"
    : "tooling_error";
};

const removeStaleWorktreeRegistration = (
  cwd: string,
  start: ChangeStartRecord,
): ProvisionChangeWorktreeResult => {
  const removed = git(cwd, "worktree", "remove", "--force", "--", start.worktreePath);
  if (!removed.ok) return { ok: false, code: "git_tooling_error" };
  const listed = git(cwd, "worktree", "list", "--porcelain");
  if (!listed.ok) return { ok: false, code: "git_tooling_error" };
  const registrations = parseWorktrees(listed.stdout);
  return registrations.some(
    (entry) => entry.path === start.worktreePath || entry.branchRef === start.branchRef,
  )
    ? { ok: false, code: "change_start_conflict" }
    : { ok: true };
};

const addRecordedWorktree = (
  cwd: string,
  start: ChangeStartRecord,
): ProvisionChangeWorktreeResult => {
  if (!ensureManagedWorktreeParent(start.worktreePath)) {
    return {
      ok: false,
      code: "managed_worktree_path_unavailable",
      path: start.worktreePath,
    };
  }
  try {
    accessSync(dirname(start.worktreePath), constants.W_OK | constants.X_OK);
  } catch {
    return {
      ok: false,
      code: "managed_worktree_path_unavailable",
      path: start.worktreePath,
    };
  }
  const branchName = start.branchRef.slice("refs/heads/".length);
  const add = git(cwd, "worktree", "add", start.worktreePath, branchName);
  return add.ok ? { ok: true } : { ok: false, code: "git_tooling_error" };
};

const managedWorktreeContainers = (worktreePath: string): readonly [string, string] => {
  const butWhyContainer = dirname(worktreePath);
  return [dirname(butWhyContainer), butWhyContainer];
};

const managedWorktreeContainersAreSafe = (worktreePath: string): boolean =>
  managedWorktreeContainers(worktreePath).every((path) => {
    try {
      if (!pathEntryExists(path)) return true;
      const entry = lstatSync(path);
      return entry.isDirectory() && !entry.isSymbolicLink();
    } catch {
      return false;
    }
  });

const ensureManagedWorktreeParent = (worktreePath: string): boolean => {
  const [siblingRoot, butWhyContainer] = managedWorktreeContainers(worktreePath);
  return ensureDirectory(siblingRoot) && ensureDirectory(butWhyContainer);
};

const ensureDirectory = (path: string): boolean => {
  try {
    if (!pathEntryExists(path)) mkdirSync(path);
    const entry = lstatSync(path);
    return entry.isDirectory() && !entry.isSymbolicLink();
  } catch {
    return false;
  }
};

type WorktreeEntry = {
  readonly path: string;
  readonly branchRef?: string;
  readonly prunable: boolean;
};

const parseWorktrees = (source: string): readonly WorktreeEntry[] =>
  source
    .split("\n\n")
    .map((block) => {
      const lines = block.split("\n");
      const path = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
      const branchRef = lines.find((line) => line.startsWith("branch "))?.slice("branch ".length);
      return path === undefined
        ? undefined
        : {
            path: canonicalPathIfPresent(path),
            ...(branchRef === undefined ? {} : { branchRef }),
            prunable: lines.some((line) => line.startsWith("prunable")),
          };
    })
    .filter((entry): entry is WorktreeEntry => entry !== undefined);

const canonicalPathIfPresent = (path: string): string =>
  existsSync(path) ? realpathSync(path) : path;

const pathEntryExists = (path: string): boolean => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

type GitResult =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly status: number | null; readonly stderr: string };

const git = (cwd: string, ...args: readonly string[]): GitResult => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status === 0
    ? { ok: true, stdout: result.stdout.trim() }
    : { ok: false, status: result.status, stderr: result.stderr.trim() };
};
