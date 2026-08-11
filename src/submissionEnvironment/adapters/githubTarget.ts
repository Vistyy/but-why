import type { GitHubPrTarget } from "../../change/validationRun/validationRun.js";
import { parseRemoteChangeBaseRef } from "../remoteChangeBaseRef.js";
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

export const detectGitHubPrTarget = (
  cwd: string,
  baseRef: string,
  runGit: GitCommandRunner = runGitCommand,
  selectedRemoteUrl?: string,
): GitHubTargetResult => {
  const selected = parseRemoteChangeBaseRef(baseRef);
  if (selected === undefined) return { ok: false, code: "PR_TARGET_NOT_FOUND" };
  const configuredUrl =
    selectedRemoteUrl === undefined
      ? runGit(["config", "--get", `remote.${selected.remoteName}.url`], cwd)
      : { ok: true as const, stdout: selectedRemoteUrl };
  if (!configuredUrl.ok) return { ok: false, code: "GITHUB_TOOLING_ERROR" };
  const remoteUrl = configuredUrl.stdout.trim();
  const repository = parseGitHubRemoteUrl(remoteUrl);
  if (repository === undefined) return { ok: false, code: "PR_TARGET_NOT_FOUND" };
  return {
    ok: true,
    target: {
      owner: repository.owner,
      repo: repository.repo,
      baseBranch: selected.branchName,
      remoteName: selected.remoteName,
      remoteUrl,
    },
  };
};

const parseGitHubRemoteUrl = (
  url: string,
): { readonly owner: string; readonly repo: string } | undefined => {
  const normalized = url
    .trim()
    .replace(/\/$/u, "")
    .replace(/\.git$/u, "");
  const match =
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/u.exec(normalized) ??
    /^git@github\.com:([^/]+)\/([^/]+)$/u.exec(normalized) ??
    /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+)$/u.exec(normalized);
  return match === null ? undefined : { owner: match[1] ?? "", repo: match[2] ?? "" };
};
