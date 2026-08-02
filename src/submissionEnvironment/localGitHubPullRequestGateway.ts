import { spawnSync } from "node:child_process";

import type { SpawnSyncOptionsWithStringEncoding } from "node:child_process";

import type { ChangePublicationTarget } from "../change/change.js";
import type {
  GitHubPullRequest,
  GitHubPullRequestGateway,
  GitHubPullRequestMutationResult,
  GitHubPullRequestRequest,
} from "../change/ownedPullRequestGateway.js";

export type PublicationCommandResult =
  | {
      readonly ok: true;
      readonly stdout: string;
      readonly stderr?: string;
      readonly status?: number;
    }
  | {
      readonly ok: false;
      readonly stdout?: string;
      readonly stderr?: string;
      readonly status?: number;
    };

const bounded = (value: string): string =>
  value
    .replace(
      /["']?(token|password|secret|authorization)["']?\s*:\s*["']?(?:bearer\s+)?[^\s,"'}]+|["']?(token|password|secret|authorization)["']?\s*=\s*(?:bearer\s+)?[^\s,"'}]+/gi,
      "$1=[redacted]",
    )
    .replace(/(https?:\/\/[^\s/:]+:[^\s@]+@)/gi, "$1[redacted]@")
    .slice(0, 1000);
const evidence = (
  operation: "remote_lookup" | "branch_push" | "pull_request_creation" | "pull_request_update",
  result: PublicationCommandResult,
  classification: "rejected" | "lost_response" | "response_parse_failure" | "unavailable",
  parseFailure?: string,
) => ({
  operation,
  classification,
  ...(result.status === undefined ? {} : { exitStatus: result.status }),
  ...(result.stdout === undefined ? {} : { stdout: bounded(result.stdout) }),
  ...(result.stderr === undefined ? {} : { stderr: bounded(result.stderr) }),
  ...(parseFailure === undefined ? {} : { parseFailure: bounded(parseFailure) }),
});

export type PublicationCommandRunner = (args: readonly string[]) => PublicationCommandResult;

export const localGitHubPullRequestGateway = (
  input: {
    readonly cwd?: string;
    readonly runGit?: PublicationCommandRunner;
    readonly runGh?: PublicationCommandRunner;
  } = {},
): GitHubPullRequestGateway => {
  const runGit = input.runGit ?? ((args) => runCommand("git", args, input.cwd));
  const runGh = input.runGh ?? ((args) => runCommand("gh", args, input.cwd));
  let lastFailureEvidence: ReturnType<typeof evidence> | undefined;

  return {
    getLastFailureEvidence: () => lastFailureEvidence,

    findPullRequests: (target, headBranch) => {
      const found = findPullRequests(
        runGh,
        target,
        headBranch,
        (result, classification, parseFailure) => {
          lastFailureEvidence = evidence("remote_lookup", result, classification, parseFailure);
        },
      );
      if (found !== undefined) lastFailureEvidence = undefined;
      return found;
    },
    getPullRequest: (target, number) => getPullRequest(runGh, target, number),
    closePullRequest: (input) => closePullRequest(runGh, input),
    createPullRequest: (request) => createPullRequest(runGit, runGh, request),
    updatePullRequest: (request) => updatePullRequest(runGit, runGh, request),
  };
};

const findPullRequests = (
  runGh: PublicationCommandRunner,
  target: ChangePublicationTarget,
  headBranch: string,
  onFailure: (
    result: PublicationCommandResult,
    classification: "rejected" | "response_parse_failure" | "unavailable",
    parseFailure?: string,
  ) => void,
): readonly GitHubPullRequest[] | undefined => {
  const query = new URLSearchParams({
    state: "open",
    head: `${target.owner}:${headBranch}`,
    base: target.baseBranch,
  });
  const result = runGh(["api", `repos/${target.owner}/${target.repo}/pulls?${query}`]);
  if (!result.ok) {
    onFailure(
      result,
      result.status === undefined && result.stderr === undefined ? "unavailable" : "rejected",
    );
    return undefined;
  }
  const parsed = parsePullRequestList(result.stdout);
  if (parsed === undefined)
    onFailure(result, "response_parse_failure", "pull request list was not valid JSON");
  return parsed;
};

const getPullRequest = (
  runGh: PublicationCommandRunner,
  target: ChangePublicationTarget,
  number: number,
): GitHubPullRequest | undefined => {
  const result = runGh(["api", `repos/${target.owner}/${target.repo}/pulls/${number}`]);
  return result.ok ? parsePullRequest(result.stdout) : undefined;
};

const closePullRequest = (
  runGh: PublicationCommandRunner,
  input: { readonly target: ChangePublicationTarget; readonly number: number },
): GitHubPullRequestMutationResult => {
  const result = runGh([
    "api",
    "--method",
    "PATCH",
    `repos/${input.target.owner}/${input.target.repo}/pulls/${input.number}`,
    "-f",
    "state=closed",
  ]);
  if (!result.ok) return { ok: false, code: "close_failed" };
  const pullRequest = parsePullRequest(result.stdout);
  return pullRequest === undefined
    ? { ok: false, code: "close_failed" }
    : { ok: true, pullRequest };
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
  if (remoteHead.kind === "unknown")
    return {
      ok: false,
      code: "push_failed",
      ...(remoteHead.evidence === undefined ? {} : { evidence: remoteHead.evidence }),
    };
  if (
    remoteHead.kind === "present" &&
    remoteHead.sha !== undefined &&
    remoteHead.sha !== request.expectedHeadSha
  )
    return { ok: false, code: "remote_head_mismatch", observedRemoteHeadSha: remoteHead.sha };
  if (
    remoteHead.kind === "present" &&
    !request.allowExistingRemoteHead &&
    remoteHead.sha !== undefined
  )
    return { ok: false, code: "remote_head_mismatch" };
  if (remoteHead.kind === "missing") {
    const pushed = pushExactHead(runGit, request);
    if (!pushed.ok)
      return {
        ok: false,
        code: "push_failed",
        evidence: evidence(
          "branch_push",
          pushed,
          pushed.status === undefined && pushed.stderr === undefined ? "unavailable" : "rejected",
        ),
      };
  }
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
  if (!result.ok) {
    const lost =
      result.status === undefined && result.stdout === undefined && result.stderr === undefined;
    return {
      ok: false,
      code: lost ? "remote_response_lost" : "remote_rejected",
      evidence: evidence("pull_request_creation", result, lost ? "lost_response" : "rejected"),
    };
  }
  const pullRequest = parsePullRequest(result.stdout);
  return pullRequest === undefined
    ? {
        ok: false,
        code: "remote_response_unusable",
        evidence: evidence(
          "pull_request_creation",
          result,
          "response_parse_failure",
          "pull request response did not contain usable facts",
        ),
      }
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
  const pushed = pushExpectedHead(runGit, request);
  if (!pushed.ok)
    return {
      ok: false,
      code: "push_failed",
      evidence: evidence(
        "branch_push",
        pushed,
        pushed.status === undefined && pushed.stderr === undefined ? "unavailable" : "rejected",
      ),
    };
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
  if (!result.ok) {
    const lost =
      result.status === undefined && result.stdout === undefined && result.stderr === undefined;
    return {
      ok: false,
      code: lost ? "remote_response_lost" : "remote_rejected",
      evidence: evidence("pull_request_update", result, lost ? "lost_response" : "rejected"),
    };
  }
  const pullRequest = parsePullRequest(result.stdout);
  return pullRequest === undefined
    ? {
        ok: false,
        code: "remote_response_unusable",
        evidence: evidence(
          "pull_request_update",
          result,
          "response_parse_failure",
          "pull request response did not contain usable facts",
        ),
      }
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
): {
  readonly kind: "missing" | "present" | "unknown";
  readonly sha?: string;
  readonly evidence?: ReturnType<typeof evidence>;
} => {
  const remoteHead = runGit([
    "ls-remote",
    "--heads",
    requestRemote(request),
    `refs/heads/${request.headBranch}`,
  ]);
  if (!remoteHead.ok)
    return { kind: "unknown", evidence: evidence("remote_lookup", remoteHead, "unavailable") };
  const sha = remoteHead.stdout.trim().split(/\s+/)[0] ?? "";
  return sha.length === 0 ? { kind: "missing" } : { kind: "present", sha };
};

const pushExactHead = (
  runGit: PublicationCommandRunner,
  request: GitHubPullRequestRequest,
): PublicationCommandResult =>
  runGit([
    "push",
    `--force-with-lease=refs/heads/${request.headBranch}:`,
    requestRemote(request),
    `${request.expectedHeadSha}:refs/heads/${request.headBranch}`,
  ]);

const pushExpectedHead = (
  runGit: PublicationCommandRunner,
  request: Parameters<GitHubPullRequestGateway["updatePullRequest"]>[0],
): PublicationCommandResult =>
  runGit([
    "push",
    `--force-with-lease=refs/heads/${request.headBranch}:${request.expectedCurrentHeadSha}`,
    requestRemote(request),
    `${request.expectedHeadSha}:refs/heads/${request.headBranch}`,
  ]);

const requestRemote = (request: Pick<GitHubPullRequestRequest, "remoteName">): string =>
  request.remoteName;

const runCommand = (
  command: string,
  args: readonly string[],
  cwd: string | undefined,
): PublicationCommandResult => {
  const options: SpawnSyncOptionsWithStringEncoding = {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...(cwd === undefined ? {} : { cwd }),
  };
  const result = spawnSync(command, args, options);
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return result.status === 0
    ? {
        ok: true,
        stdout,
        ...(stderr.length === 0 ? {} : { stderr }),
        ...(result.status === null ? {} : { status: result.status }),
      }
    : {
        ok: false,
        stdout,
        ...(stderr.length === 0 ? {} : { stderr }),
        ...(result.status === null ? {} : { status: result.status }),
      };
};

type GitHubPullRequestJson = {
  readonly number?: unknown;
  readonly url?: unknown;
  readonly html_url?: unknown;
  readonly state?: unknown;
  readonly merged?: unknown;
  readonly merged_at?: unknown;
  readonly base?: {
    readonly ref?: unknown;
    readonly repo?: { readonly owner?: { readonly login?: unknown }; readonly name?: unknown };
  };
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
  const url = selectPullRequestUrl(pullRequest);
  if (
    typeof pullRequest.number !== "number" ||
    url === undefined ||
    typeof pullRequest.base?.ref !== "string" ||
    typeof pullRequest.head?.ref !== "string" ||
    typeof pullRequest.head?.sha !== "string"
  ) {
    return undefined;
  }
  const repository = repositoryIdentity(pullRequest.base.repo);
  const state =
    pullRequest.state === "open" || pullRequest.state === "closed" ? pullRequest.state : undefined;
  const merged =
    typeof pullRequest.merged === "boolean"
      ? pullRequest.merged
      : pullRequest.merged_at === null
        ? false
        : typeof pullRequest.merged_at === "string"
          ? true
          : undefined;
  return {
    number: pullRequest.number,
    url,
    baseBranch: pullRequest.base.ref,
    headBranch: pullRequest.head.ref,
    headSha: pullRequest.head.sha,
    ...(state === undefined ? {} : { state }),
    ...(merged === undefined ? {} : { merged }),
    ...(repository === undefined ? {} : { repository }),
  };
};

const selectPullRequestUrl = (pullRequest: GitHubPullRequestJson): string | undefined =>
  validHttpUrl(pullRequest.html_url)
    ? pullRequest.html_url
    : validHttpUrl(pullRequest.url)
      ? pullRequest.url
      : undefined;

const validHttpUrl = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

const repositoryIdentity = (
  value: { readonly owner?: { readonly login?: unknown }; readonly name?: unknown } | undefined,
): { readonly owner: string; readonly repo: string } | undefined =>
  typeof value?.owner?.login === "string" && typeof value.name === "string"
    ? { owner: value.owner.login, repo: value.name }
    : undefined;

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
};
