import { spawnSync } from "node:child_process";

import type { RemoteChangeBaseError, RemoteChangeBaseResult } from "../remoteChangeBase.js";
import { parseRemoteChangeBaseRef } from "../remoteChangeBaseRef.js";

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
  if (remoteNames.length === 1) {
    const [remoteName] = remoteNames;
    if (remoteName === undefined) return { ok: false, code: "publication_remote_missing" };
    return { ok: true, remoteName };
  }
  const upstreamRemote = invokingBranchUpstreamRemote(cwd);
  if (upstreamRemote !== undefined && remoteNames.includes(upstreamRemote)) {
    return { ok: true, remoteName: upstreamRemote };
  }
  if (remoteNames.includes("origin")) return { ok: true, remoteName: "origin" };
  return { ok: false, code: "publication_remote_ambiguous", remoteNames };
};

const invokingBranchUpstreamRemote = (cwd: string): string | undefined => {
  const branch = git(cwd, "symbolic-ref", "--quiet", "--short", "HEAD");
  if (!branch.ok || branch.stdout.length === 0) return undefined;
  const remote = git(cwd, "config", "--get", `branch.${branch.stdout}.remote`);
  const merge = git(cwd, "config", "--get", `branch.${branch.stdout}.merge`);
  return remote.ok && remote.stdout.length > 0 && merge.ok && merge.stdout.startsWith("refs/heads/")
    ? remote.stdout
    : undefined;
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
