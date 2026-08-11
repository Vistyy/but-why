import { spawnSync } from "node:child_process";

import { parseRemoteChangeBaseRef } from "../remoteChangeBaseRef.js";

export type RemoteChangeBase = {
  readonly remoteName: string;
  readonly branchName: string;
  readonly remoteUrl: string;
  readonly ref: string;
  readonly commit: string;
};

export type RemoteChangeBaseError =
  | { readonly ok: false; readonly code: "publication_remote_missing" }
  | {
      readonly ok: false;
      readonly code: "publication_remote_ambiguous";
      readonly remoteNames: readonly string[];
    }
  | {
      readonly ok: false;
      readonly code: "publication_remote_unreachable";
      readonly remoteName: string;
    }
  | {
      readonly ok: false;
      readonly code: "remote_default_branch_missing";
      readonly remoteName: string;
    }
  | {
      readonly ok: false;
      readonly code: "remote_branch_missing";
      readonly remoteName: string;
      readonly branchName: string;
    }
  | { readonly ok: false; readonly code: "invalid_remote_change_base"; readonly baseRef: string }
  | {
      readonly ok: false;
      readonly code: "publication_remote_changed";
      readonly remoteName: string;
      readonly expectedRemoteUrl: string;
      readonly actualRemoteUrl: string;
    };

export type RemoteChangeBaseResult =
  | { readonly ok: true; readonly base: RemoteChangeBase }
  | RemoteChangeBaseError;

export const fetchRemoteChangeBase = (
  cwd: string,
  requestedBranch?: string,
): RemoteChangeBaseResult => {
  const selected = selectPublicationRemote(cwd);
  if (!selected.ok) return selected;
  const branch =
    requestedBranch === undefined
      ? readRemoteDefaultBranch(cwd, selected.remoteName)
      : { ok: true as const, branchName: requestedBranch };
  if (!branch.ok) return branch;
  return fetchSelectedBranch(cwd, selected.remoteName, branch.branchName);
};

export const refreshRemoteChangeBase = (
  cwd: string,
  baseRef: string,
  expectedRemoteUrl: string,
): RemoteChangeBaseResult => {
  const parsed = parseRemoteChangeBaseRef(baseRef);
  if (parsed === undefined) return { ok: false, code: "invalid_remote_change_base", baseRef };
  const configuredUrl = readConfiguredRemoteUrl(cwd, parsed.remoteName);
  if (configuredUrl === undefined) {
    return { ok: false, code: "publication_remote_missing" };
  }
  if (configuredUrl !== expectedRemoteUrl) {
    return {
      ok: false,
      code: "publication_remote_changed",
      remoteName: parsed.remoteName,
      expectedRemoteUrl,
      actualRemoteUrl: configuredUrl,
    };
  }
  return fetchSelectedBranch(cwd, parsed.remoteName, parsed.branchName);
};

const selectPublicationRemote = (
  cwd: string,
):
  | { readonly ok: true; readonly remoteName: string }
  | Extract<
      RemoteChangeBaseError,
      { readonly code: "publication_remote_missing" | "publication_remote_ambiguous" }
    > => {
  const listed = git(cwd, "remote");
  if (!listed.ok) return { ok: false, code: "publication_remote_missing" };
  const remoteNames = listed.stdout
    .split("\n")
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .filter((name) => {
      const configuredUrl = git(cwd, "config", "--get", `remote.${name}.url`);
      return configuredUrl.ok && isGitHubRemoteUrl(configuredUrl.stdout);
    });
  if (remoteNames.length === 0) return { ok: false, code: "publication_remote_missing" };
  if (remoteNames.length === 1) return { ok: true, remoteName: remoteNames[0] as string };
  const upstreamRemote = canonicalMainCheckoutUpstreamRemote(cwd);
  if (upstreamRemote !== undefined && remoteNames.includes(upstreamRemote)) {
    return { ok: true, remoteName: upstreamRemote };
  }
  if (remoteNames.includes("origin")) return { ok: true, remoteName: "origin" };
  return { ok: false, code: "publication_remote_ambiguous", remoteNames };
};

const canonicalMainCheckoutUpstreamRemote = (cwd: string): string | undefined => {
  const worktrees = git(cwd, "worktree", "list", "--porcelain");
  if (!worktrees.ok) return undefined;
  const primaryBranchRef = worktrees.stdout
    .split("\n\n")[0]
    ?.split("\n")
    .find((line) => line.startsWith("branch "))
    ?.slice("branch ".length);
  if (primaryBranchRef?.startsWith("refs/heads/") !== true) return undefined;
  const branchName = primaryBranchRef.slice("refs/heads/".length);
  const configured = git(cwd, "config", "--get", `branch.${branchName}.remote`);
  return configured.ok && configured.stdout.length > 0 ? configured.stdout : undefined;
};

const isGitHubRemoteUrl = (url: string): boolean => {
  const normalized = url.endsWith(".git") ? url.slice(0, -4) : url;
  return (
    /^https:\/\/github\.com\/[^/]+\/[^/]+$/u.test(normalized) ||
    /^git@github\.com:[^/]+\/[^/]+$/u.test(normalized) ||
    /^ssh:\/\/git@github\.com\/[^/]+\/[^/]+$/u.test(normalized)
  );
};

const readRemoteDefaultBranch = (
  cwd: string,
  remoteName: string,
):
  | { readonly ok: true; readonly branchName: string }
  | Extract<
      RemoteChangeBaseError,
      { readonly code: "publication_remote_unreachable" | "remote_default_branch_missing" }
    > => {
  const result = git(cwd, "ls-remote", "--symref", remoteName, "HEAD");
  if (!result.ok) return { ok: false, code: "publication_remote_unreachable", remoteName };
  const branchName = result.stdout
    .split("\n")
    .map((line) => /^ref: refs\/heads\/(.+)\tHEAD$/u.exec(line)?.[1])
    .find((name) => name !== undefined);
  return branchName === undefined
    ? { ok: false, code: "remote_default_branch_missing", remoteName }
    : { ok: true, branchName };
};

const fetchSelectedBranch = (
  cwd: string,
  remoteName: string,
  branchName: string,
): RemoteChangeBaseResult => {
  const remoteBranch = git(
    cwd,
    "ls-remote",
    "--exit-code",
    "--heads",
    remoteName,
    `refs/heads/${branchName}`,
  );
  if (!remoteBranch.ok) {
    return remoteBranch.status === 2
      ? { ok: false, code: "remote_branch_missing", remoteName, branchName }
      : { ok: false, code: "publication_remote_unreachable", remoteName };
  }
  const remoteUrl = readConfiguredRemoteUrl(cwd, remoteName);
  if (remoteUrl === undefined) return { ok: false, code: "publication_remote_missing" };
  const ref = `refs/remotes/${remoteName}/${branchName}`;
  const fetched = git(cwd, "fetch", "--no-tags", remoteName, `+refs/heads/${branchName}:${ref}`);
  if (!fetched.ok) return { ok: false, code: "publication_remote_unreachable", remoteName };
  const resolved = git(cwd, "rev-parse", "--verify", `${ref}^{commit}`);
  if (!resolved.ok) return { ok: false, code: "remote_branch_missing", remoteName, branchName };
  return {
    ok: true,
    base: { remoteName, branchName, remoteUrl, ref, commit: resolved.stdout },
  };
};

const readConfiguredRemoteUrl = (cwd: string, remoteName: string): string | undefined => {
  const configured = git(cwd, "config", "--get", `remote.${remoteName}.url`);
  return configured.ok && configured.stdout.length > 0 ? configured.stdout : undefined;
};

type GitResult =
  | { readonly ok: true; readonly stdout: string; readonly status: 0 }
  | { readonly ok: false; readonly status: number | null };

const git = (cwd: string, ...args: readonly string[]): GitResult => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status === 0
    ? { ok: true, stdout: result.stdout.trim(), status: 0 }
    : { ok: false, status: result.status };
};
