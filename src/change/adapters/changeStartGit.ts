import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { decodeRepoConfigSource } from "../../init/adapters/repoConfig.js";
import type { LocalRepositoryContext } from "../../repositoryRuntime/repositoryContext.js";
import { fetchRemoteChangeBase } from "../../submissionEnvironment/adapters/remoteChangeBase.js";
import { resolveLocalBranch } from "../candidateCapture/adapters/localGitCandidate.js";
import { changeBranchOwnershipRef, changeBranchRefForSlug } from "../changeBranch.js";
import type {
  ProvisionChangeWorktreeFailure,
  ProvisionChangeWorktreeResult,
  ResolveChangeStartGitResult,
} from "../changeStartGitOperations.js";
import type { ChangeStartRecord } from "../changeStartStore.js";

export const resolveChangeStartGitIntent = (
  context: LocalRepositoryContext,
  slug: string,
  requestedBaseBranch?: string,
): ResolveChangeStartGitResult => {
  const fetched = fetchRemoteChangeBase(context.root, requestedBaseBranch);
  if (!fetched.ok) return fetched;
  const baseRef = fetched.base.ref;
  const startingCommit = fetched.base.commit;

  const configSource = git(context.root, "show", `${startingCommit}:.but-why/config.json`);
  if (!configSource.ok) return { ok: false, code: "committed_repo_config_missing" };

  const config = decodeRepoConfigSource(configSource.stdout);
  if (!config.ok || config.config.idPrefix !== context.idPrefix) {
    return { ok: false, code: "committed_repo_config_invalid" };
  }

  const branchRef = changeBranchRefForSlug(slug);
  if (resolveLocalBranch(context.root, branchRef) !== undefined) {
    return { ok: false, code: "change_start_conflict" };
  }
  return {
    ok: true,
    intent: {
      repositoryCommonDirectory: context.commonDirectory,
      baseRef,
      baseRemoteUrl: fetched.base.remoteUrl,
      branchRef,
      startingCommit,
      worktreePath: join(
        dirname(context.mainCheckoutRoot),
        `${basename(context.mainCheckoutRoot)}-worktrees`,
        "but-why",
        slug,
      ),
      ...(config.config.prepare === undefined
        ? {}
        : {
            prepare: {
              command: config.config.prepare.command,
              timeoutSeconds: config.config.prepare.timeoutSeconds ?? 1200,
            },
          }),
    },
  };
};

export const provisionChangeWorktree = (
  cwd: string,
  start: ChangeStartRecord,
  recovering: boolean,
): ProvisionChangeWorktreeResult => {
  if (!recovering && resolveLocalBranch(cwd, start.branchRef) !== undefined) {
    return { ok: false, code: "change_start_conflict" };
  }
  const worktreesResult = git(cwd, "worktree", "list", "--porcelain");
  if (!worktreesResult.ok) return { ok: false, code: "git_tooling_error" };

  const branch = ensureRecordedBranch(cwd, start, recovering);
  if (!branch.ok) return branch;

  const worktree = inspectRecordedWorktree(start, parseWorktrees(worktreesResult.stdout));
  if (worktree !== "missing" && worktree !== "stale") return worktree;
  if (worktree === "stale") {
    const removed = removeStaleWorktreeRegistration(cwd, start);
    if (!removed.ok) return removed;
  }
  return addRecordedWorktree(cwd, start, branch.observedCommit);
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

type EnsureRecordedBranchResult =
  | { readonly ok: true; readonly observedCommit: string }
  | ProvisionChangeWorktreeFailure;

const ensureRecordedBranch = (
  cwd: string,
  start: ChangeStartRecord,
  recovering: boolean,
): EnsureRecordedBranchResult => {
  const branchCommit = resolveLocalBranch(cwd, start.branchRef);
  if (branchCommit !== undefined) {
    if (!recovering) return { ok: false, code: "change_start_conflict" };
    const ownership = recordedBranchOwnership(cwd, start, branchCommit);
    return ownership === "owned"
      ? { ok: true, observedCommit: branchCommit }
      : {
          ok: false,
          code: ownership === "foreign" ? "change_start_conflict" : "git_tooling_error",
        };
  }
  const markerRef = branchOwnershipRef(start);
  const markerCommit = resolveLocalBranch(cwd, markerRef);
  const create =
    recovering && markerCommit === start.startingCommit
      ? git(
          cwd,
          "update-ref",
          start.branchRef,
          start.startingCommit,
          "0000000000000000000000000000000000000000",
        )
      : gitWithInput(
          cwd,
          `create ${start.branchRef} ${start.startingCommit}\ncreate ${markerRef} ${start.startingCommit}\n`,
          "update-ref",
          "--stdin",
        );
  return create.ok
    ? { ok: true, observedCommit: start.startingCommit }
    : { ok: false, code: "git_tooling_error" };
};

const branchOwnershipRef = (start: ChangeStartRecord): string => {
  const ownershipRef = changeBranchOwnershipRef(start.branchRef);
  if (ownershipRef === undefined) throw new Error("Invalid Change branch ref");
  return ownershipRef;
};

const recordedBranchOwnership = (
  cwd: string,
  start: ChangeStartRecord,
  branchCommit: string,
): "owned" | "foreign" | "tooling_error" => {
  const ownershipRef = branchOwnershipRef(start);
  const markerExists = git(cwd, "show-ref", "--verify", "--quiet", ownershipRef);
  if (!markerExists.ok) return markerExists.status === 1 ? "foreign" : "tooling_error";
  const marker = git(cwd, "rev-parse", "--verify", `${ownershipRef}^{commit}`);
  if (!marker.ok) return "tooling_error";
  if (marker.stdout !== start.startingCommit) return "foreign";
  const lineage = git(cwd, "merge-base", "--is-ancestor", start.startingCommit, branchCommit);
  return lineage.ok ? "owned" : lineage.status === 1 ? "foreign" : "tooling_error";
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
  observedCommit: string,
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
  if (!add.ok) return { ok: false, code: "git_tooling_error" };
  const head = git(start.worktreePath, "rev-parse", "HEAD^{commit}");
  if (head.ok && head.stdout === observedCommit) return { ok: true };
  const removed = git(cwd, "worktree", "remove", "--force", "--", start.worktreePath);
  return removed.ok
    ? { ok: false, code: "change_start_conflict" }
    : { ok: false, code: "git_tooling_error" };
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

const git = (cwd: string, ...args: readonly string[]): GitResult =>
  gitWithInput(cwd, undefined, ...args);

const gitWithInput = (
  cwd: string,
  input: string | undefined,
  ...args: readonly string[]
): GitResult => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    ...(input === undefined ? { stdio: ["ignore", "pipe", "pipe"] } : { input }),
  });
  return result.status === 0
    ? { ok: true, stdout: result.stdout.trim() }
    : { ok: false, status: result.status, stderr: result.stderr.trim() };
};
