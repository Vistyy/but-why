import { spawnSync } from "node:child_process";

import type { ChangePublicationTarget } from "../change/change.js";
import type {
  GitHubPullRequest,
  GitHubPullRequestGateway,
  GitHubPullRequestRequest,
} from "./publishCandidate.js";

export type PublicationCommandResult =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false };

export type PublicationCommandRunner = (args: readonly string[]) => PublicationCommandResult;

export const localGitHubPullRequestGateway = (
  input: {
    readonly runGit?: PublicationCommandRunner;
    readonly runGh?: PublicationCommandRunner;
  } = {},
): GitHubPullRequestGateway => {
  const runGit = input.runGit ?? runGitCommand;
  const runGh = input.runGh ?? runGhCommand;

  return {
    findPullRequests: (target, headBranch) => findPullRequests(runGh, target, headBranch),
    getPullRequest: (target, number) => getPullRequest(runGh, target, number),
    createPullRequest: (request) => createPullRequest(runGit, runGh, request),
    updatePullRequest: (request) => updatePullRequest(runGit, runGh, request),
  };
};

const findPullRequests = (
  runGh: PublicationCommandRunner,
  target: ChangePublicationTarget,
  headBranch: string,
): readonly GitHubPullRequest[] | undefined => {
  const query = new URLSearchParams({
    state: "open",
    head: `${target.owner}:${headBranch}`,
    base: target.baseBranch,
  });
  const result = runGh(["api", `repos/${target.owner}/${target.repo}/pulls?${query}`]);
  if (!result.ok) return undefined;
  return parsePullRequestList(result.stdout);
};

const getPullRequest = (
  runGh: PublicationCommandRunner,
  target: ChangePublicationTarget,
  number: number,
): GitHubPullRequest | undefined => {
  const result = runGh(["api", `repos/${target.owner}/${target.repo}/pulls/${number}`]);
  return result.ok ? parsePullRequest(result.stdout) : undefined;
};

const createPullRequest = (
  runGit: PublicationCommandRunner,
  runGh: PublicationCommandRunner,
  request: GitHubPullRequestRequest,
): ReturnType<GitHubPullRequestGateway["createPullRequest"]> => {
  if (!hasExpectedLocalHead(runGit, request)) {
    return { ok: false, code: "local_head_mismatch" };
  }
  const remoteHead = initialRemoteHeadState(runGit, request);
  if (remoteHead === "present") return { ok: false, code: "remote_head_mismatch" };
  if (remoteHead === "unknown") return { ok: false, code: "push_failed" };
  if (!pushExactHead(runGit, request)) return { ok: false, code: "push_failed" };
  const result = runGh([
    "api",
    "--method",
    "POST",
    `repos/${request.owner}/${request.repo}/pulls`,
    "-f",
    `title=${request.title}`,
    "-f",
    `head=${request.headBranch}`,
    "-f",
    `base=${request.baseBranch}`,
    "-f",
    `body=${request.body}`,
  ]);
  if (!result.ok) return { ok: false, code: "remote_response_lost" };
  const pullRequest = parsePullRequest(result.stdout);
  return pullRequest === undefined
    ? { ok: false, code: "remote_response_lost" }
    : { ok: true, pullRequest };
};

const updatePullRequest = (
  runGit: PublicationCommandRunner,
  runGh: PublicationCommandRunner,
  request: Parameters<GitHubPullRequestGateway["updatePullRequest"]>[0],
): ReturnType<GitHubPullRequestGateway["updatePullRequest"]> => {
  if (!hasExpectedLocalHead(runGit, request)) {
    return { ok: false, code: "local_head_mismatch" };
  }
  if (!pushExpectedHead(runGit, request)) return { ok: false, code: "push_failed" };
  const result = runGh([
    "api",
    "--method",
    "PATCH",
    `repos/${request.owner}/${request.repo}/pulls/${request.number}`,
    "-f",
    `title=${request.title}`,
    "-f",
    `body=${request.body}`,
  ]);
  if (!result.ok) return { ok: false, code: "remote_response_lost" };
  const pullRequest = parsePullRequest(result.stdout);
  return pullRequest === undefined
    ? { ok: false, code: "remote_response_lost" }
    : { ok: true, pullRequest };
};

const hasExpectedLocalHead = (
  runGit: PublicationCommandRunner,
  request: GitHubPullRequestRequest,
): boolean => {
  const currentHead = runGit(["rev-parse", "--verify", `${request.branchRef}^{commit}`]);
  return currentHead.ok && currentHead.stdout.trim() === request.expectedHeadSha;
};

const initialRemoteHeadState = (
  runGit: PublicationCommandRunner,
  request: GitHubPullRequestRequest,
): "missing" | "present" | "unknown" => {
  const remoteHead = runGit([
    "ls-remote",
    "--heads",
    requestRemote(request),
    `refs/heads/${request.headBranch}`,
  ]);
  if (!remoteHead.ok) return "unknown";
  return remoteHead.stdout.trim().length === 0 ? "missing" : "present";
};

const pushExactHead = (
  runGit: PublicationCommandRunner,
  request: GitHubPullRequestRequest,
): boolean =>
  runGit([
    "push",
    `--force-with-lease=refs/heads/${request.headBranch}:`,
    requestRemote(request),
    `${request.expectedHeadSha}:refs/heads/${request.headBranch}`,
  ]).ok;

const pushExpectedHead = (
  runGit: PublicationCommandRunner,
  request: Parameters<GitHubPullRequestGateway["updatePullRequest"]>[0],
): boolean =>
  runGit([
    "push",
    `--force-with-lease=refs/heads/${request.headBranch}:${request.expectedCurrentHeadSha}`,
    requestRemote(request),
    `${request.expectedHeadSha}:refs/heads/${request.headBranch}`,
  ]).ok;

const requestRemote = (request: Pick<GitHubPullRequestRequest, "remoteName">): string =>
  request.remoteName;

const runGitCommand: PublicationCommandRunner = (args) => runCommand("git", args);
const runGhCommand: PublicationCommandRunner = (args) => runCommand("gh", args);

const runCommand = (command: string, args: readonly string[]): PublicationCommandResult => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? { ok: true, stdout: result.stdout } : { ok: false };
};

type GitHubPullRequestJson = {
  readonly number?: unknown;
  readonly url?: unknown;
  readonly base?: { readonly ref?: unknown };
  readonly head?: { readonly ref?: unknown; readonly sha?: unknown };
};

const parsePullRequestList = (value: string): readonly GitHubPullRequest[] | undefined => {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return undefined;
  const pullRequests = parsed.map((item) => parsePullRequestObject(item));
  return pullRequests.every((item) => item !== undefined)
    ? (pullRequests as readonly GitHubPullRequest[])
    : undefined;
};

const parsePullRequest = (value: string): GitHubPullRequest | undefined =>
  parsePullRequestObject(parseJson(value));

const parsePullRequestObject = (value: unknown): GitHubPullRequest | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const pullRequest = value as GitHubPullRequestJson;
  return typeof pullRequest.number === "number" &&
    typeof pullRequest.url === "string" &&
    typeof pullRequest.base?.ref === "string" &&
    typeof pullRequest.head?.ref === "string" &&
    typeof pullRequest.head?.sha === "string"
    ? {
        number: pullRequest.number,
        url: pullRequest.url,
        baseBranch: pullRequest.base.ref,
        headBranch: pullRequest.head.ref,
        headSha: pullRequest.head.sha,
      }
    : undefined;
};

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
};
