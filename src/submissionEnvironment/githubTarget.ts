import { spawnSync } from "node:child_process";

import type { GitHubPrTarget } from "../validationRun/validationRun.js";
import { type GitCommandRunner, runGitCommand } from "./gitFacts.js";

export type GitHubTargetResult =
  | {
      readonly ok: true;
      readonly target: GitHubPrTarget;
    }
  | {
      readonly ok: false;
      readonly code: GitHubTargetErrorCode;
    };

export type GitHubTargetErrorCode = "PR_TARGET_NOT_FOUND" | "GITHUB_TOOLING_ERROR";

export type GhCommandResult =
  | {
      readonly ok: true;
      readonly stdout: string;
    }
  | {
      readonly ok: false;
      readonly code: "command_failed" | "tooling_error";
    };

export type GhCommandRunner = (args: readonly string[], cwd: string) => GhCommandResult;

const runGhCommand: GhCommandRunner = (args, cwd) => {
  const result = spawnSync("gh", [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  if (result.error !== undefined) {
    return { ok: false, code: "tooling_error" };
  }

  if (result.status !== 0) {
    return { ok: false, code: "command_failed" };
  }

  return { ok: true, stdout: result.stdout };
};

export const detectGitHubPrTarget = (
  cwd: string,
  currentBranch: string,
  runGit: GitCommandRunner = runGitCommand,
  runGh: GhCommandRunner = runGhCommand,
): GitHubTargetResult => {
  const remote = selectGitHubRemote(cwd, runGit);

  if (!remote.ok) {
    return { ok: false, code: remote.code };
  }

  const prBaseBranch = readExistingPullRequestBase(cwd, remote.repository, currentBranch, runGh);

  if (!prBaseBranch.ok) {
    return { ok: false, code: prBaseBranch.code };
  }

  const defaultBranch =
    prBaseBranch.baseBranch === undefined
      ? readRepositoryDefaultBranch(cwd, remote.repository, runGh)
      : { ok: true as const, baseBranch: prBaseBranch.baseBranch };

  if (!defaultBranch.ok) {
    return { ok: false, code: defaultBranch.code };
  }

  if (defaultBranch.baseBranch === undefined) {
    return { ok: false, code: "PR_TARGET_NOT_FOUND" };
  }

  return {
    ok: true,
    target: {
      owner: remote.repository.owner,
      repo: remote.repository.repo,
      baseBranch: defaultBranch.baseBranch,
      remoteName: remote.name,
      remoteUrl: remote.url,
    },
  };
};

type GitHubRepository = {
  readonly owner: string;
  readonly repo: string;
};

type GitHubRemote = {
  readonly name: string;
  readonly url: string;
  readonly repository: GitHubRepository;
};

type RemoteSelectionResult =
  | {
      readonly ok: true;
      readonly name: string;
      readonly url: string;
      readonly repository: GitHubRepository;
    }
  | {
      readonly ok: false;
      readonly code: GitHubTargetErrorCode;
    };

const selectGitHubRemote = (cwd: string, runGit: GitCommandRunner): RemoteSelectionResult => {
  const remotes = listGitHubRemotes(cwd, runGit);

  if (!remotes.ok) {
    return remotes;
  }

  if (remotes.remotes.length === 0) {
    return { ok: false, code: "PR_TARGET_NOT_FOUND" };
  }

  const upstreamRemoteName = currentBranchUpstreamRemote(cwd, runGit);

  if (upstreamRemoteName !== undefined) {
    const upstreamRemote = remotes.remotes.find((remote) => remote.name === upstreamRemoteName);

    if (upstreamRemote !== undefined) {
      return { ok: true, ...upstreamRemote };
    }
  }

  const origin = remotes.remotes.find((remote) => remote.name === "origin");

  if (origin !== undefined) {
    return { ok: true, ...origin };
  }

  return { ok: false, code: "PR_TARGET_NOT_FOUND" };
};

type GitHubRemotesResult =
  | {
      readonly ok: true;
      readonly remotes: readonly GitHubRemote[];
    }
  | {
      readonly ok: false;
      readonly code: "GITHUB_TOOLING_ERROR";
    };

const listGitHubRemotes = (cwd: string, runGit: GitCommandRunner): GitHubRemotesResult => {
  const remoteNames = runGit(["remote"], cwd);

  if (!remoteNames.ok) {
    return { ok: false, code: "GITHUB_TOOLING_ERROR" };
  }

  const remotes: GitHubRemote[] = [];

  for (const name of remoteNames.stdout
    .split("\n")
    .map((remote) => remote.trim())
    .filter((remote) => remote.length > 0)) {
    const url = runGit(["remote", "get-url", name], cwd);

    if (!url.ok) {
      return { ok: false, code: "GITHUB_TOOLING_ERROR" };
    }

    const remoteUrl = url.stdout.trim();
    const repository = parseGitHubRemoteUrl(remoteUrl);

    if (repository !== undefined) {
      remotes.push({ name, url: remoteUrl, repository });
    }
  }

  return { ok: true, remotes };
};

const currentBranchUpstreamRemote = (cwd: string, runGit: GitCommandRunner): string | undefined => {
  const upstream = runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd);

  if (!upstream.ok) {
    return undefined;
  }

  const upstreamRef = upstream.stdout.trim();
  const slashIndex = upstreamRef.indexOf("/");

  if (slashIndex <= 0) {
    return undefined;
  }

  return upstreamRef.slice(0, slashIndex);
};

type BranchLookupResult =
  | {
      readonly ok: true;
      readonly baseBranch: string | undefined;
    }
  | {
      readonly ok: false;
      readonly code: "GITHUB_TOOLING_ERROR";
    };

const readExistingPullRequestBase = (
  cwd: string,
  repository: GitHubRepository,
  currentBranch: string,
  runGh: GhCommandRunner,
): BranchLookupResult => {
  const result = runGh(
    [
      "pr",
      "view",
      "--repo",
      `${repository.owner}/${repository.repo}`,
      "--head",
      currentBranch,
      "--json",
      "baseRefName",
    ],
    cwd,
  );

  if (!result.ok) {
    return result.code === "tooling_error"
      ? { ok: false, code: "GITHUB_TOOLING_ERROR" }
      : { ok: true, baseBranch: undefined };
  }

  const value = parseJsonObject(result.stdout);
  // biome-ignore lint/complexity/useLiteralKeys: TS index signature
  const baseRefName = value?.["baseRefName"];

  return {
    ok: true,
    baseBranch: typeof baseRefName === "string" && baseRefName.length > 0 ? baseRefName : undefined,
  };
};

const readRepositoryDefaultBranch = (
  cwd: string,
  repository: GitHubRepository,
  runGh: GhCommandRunner,
): BranchLookupResult => {
  const result = runGh(
    ["repo", "view", `${repository.owner}/${repository.repo}`, "--json", "defaultBranchRef"],
    cwd,
  );

  if (!result.ok) {
    return { ok: false, code: "GITHUB_TOOLING_ERROR" };
  }

  const value = parseJsonObject(result.stdout);
  // biome-ignore lint/complexity/useLiteralKeys: TS index signature
  const defaultBranchRef = value?.["defaultBranchRef"];

  if (typeof defaultBranchRef !== "object" || defaultBranchRef === null) {
    return { ok: true, baseBranch: undefined };
  }

  const name = (defaultBranchRef as { readonly name?: unknown }).name;

  return {
    ok: true,
    baseBranch: typeof name === "string" && name.length > 0 ? name : undefined,
  };
};

const parseGitHubRemoteUrl = (url: string): GitHubRepository | undefined => {
  const normalized = url.endsWith(".git") ? url.slice(0, -4) : url;
  const httpsMatch = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(normalized);

  if (httpsMatch !== null) {
    return { owner: httpsMatch[1] ?? "", repo: httpsMatch[2] ?? "" };
  }

  const sshMatch = /^git@github\.com:([^/]+)\/([^/]+)$/.exec(normalized);

  if (sshMatch !== null) {
    return { owner: sshMatch[1] ?? "", repo: sshMatch[2] ?? "" };
  }

  const sshUrlMatch = /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+)$/.exec(normalized);

  if (sshUrlMatch !== null) {
    return { owner: sshUrlMatch[1] ?? "", repo: sshUrlMatch[2] ?? "" };
  }

  return undefined;
};

const parseJsonObject = (value: string): Record<string, unknown> | undefined => {
  try {
    const parsed: unknown = JSON.parse(value);

    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};
