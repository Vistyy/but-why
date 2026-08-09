import type { SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { spawnSync } from "node:child_process";

import type { ChangePublicationTarget } from "../change/change.js";
import { changeBranchNameForRef } from "../change/changeBranch.js";
import type {
  ChangeCleanupRemote,
  RemoteBranchDeletionResult,
  RemoteBranchHeadResult,
} from "../change/changeCleanupRemote.js";
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

const classifyCommandFailure = (result: PublicationCommandResult): "rejected" | "unavailable" =>
  result.status === undefined && result.stdout === undefined && result.stderr === undefined
    ? "unavailable"
    : "rejected";

const evidence = (
  operation:
    | "remote_lookup"
    | "push_destination"
    | "branch_push"
    | "pull_request_creation"
    | "pull_request_update",
  result: PublicationCommandResult,
  classification: "rejected" | "lost_response" | "response_parse_failure" | "unavailable",
  _parseFailure?: string,
) => ({
  operation,
  classification,
  ...(result.status === undefined ? {} : { exitStatus: result.status }),
});

export type PublicationCommandRunner = (args: readonly string[]) => PublicationCommandResult;

export const githubChangeCleanupRemote = (
  gateway: GitHubPullRequestGateway,
): ChangeCleanupRemote => ({
  readRemoteBranchHead: gateway.readRemoteBranchHead ?? (() => ({ state: "unavailable" as const })),
  deleteRemoteBranch: gateway.deleteRemoteBranch ?? (() => ({ state: "failed" as const })),
});

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
    getPullRequest: (target, number) => {
      const result = getPullRequest(
        runGh,
        target,
        number,
        (command, classification, parseFailure) => {
          lastFailureEvidence = evidence("remote_lookup", command, classification, parseFailure);
        },
      );
      return result;
    },
    closePullRequest: (input) => closePullRequest(runGh, input),
    readRemoteBranchHead: (input) => readRemoteBranchHead(runGh, input),
    deleteRemoteBranch: (input) => deleteRemoteBranch(runGh, input),
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
      result.status === undefined && result.stdout === undefined && result.stderr === undefined
        ? "unavailable"
        : "rejected",
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
  onFailure: (
    result: PublicationCommandResult,
    classification: "rejected" | "response_parse_failure" | "unavailable",
    parseFailure?: string,
  ) => void,
): GitHubPullRequest | undefined => {
  const result = runGh(["api", `repos/${target.owner}/${target.repo}/pulls/${number}`]);
  if (!result.ok) {
    onFailure(
      result,
      result.status === undefined && result.stdout === undefined && result.stderr === undefined
        ? "unavailable"
        : "rejected",
    );
    return undefined;
  }
  const parsed = parsePullRequest(result.stdout);
  if (parsed === undefined)
    onFailure(result, "response_parse_failure", "pull request response was not usable");
  return parsed;
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

const remoteBranchQuery = `query($owner: String!, $repo: String!, $qualifiedName: String!) {
  repository(owner: $owner, name: $repo) {
    id
    defaultBranchRef { name }
    ref(qualifiedName: $qualifiedName) {
      id
      name
      target { oid }
    }
  }
}`;

const publicationRemoteBranchQuery = `query($owner: String!, $repo: String!, $qualifiedName: String!) {
  repository(owner: $owner, name: $repo) {
    ref(qualifiedName: $qualifiedName) {
      name
      prefix
      target { oid }
    }
  }
}`;

const remoteBranchDeletionMutation = `mutation($repositoryId: ID!, $name: GitRefname!, $beforeOid: GitObjectID!, $afterOid: GitObjectID!) {
  updateRefs(input: {
    repositoryId: $repositoryId
    refUpdates: [{ name: $name, beforeOid: $beforeOid, afterOid: $afterOid }]
  }) {
    clientMutationId
  }
}`;

const zeroSha = "0".repeat(40);

const githubRepository = (
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

type RemoteBranchCleanupInput = Parameters<ChangeCleanupRemote["readRemoteBranchHead"]>[0];

type RemoteBranchQueryJson = {
  readonly data?: {
    readonly repository?: {
      readonly id?: unknown;
      readonly defaultBranchRef?: { readonly name?: unknown } | null;
      readonly ref?: {
        readonly id?: unknown;
        readonly name?: unknown;
        readonly target?: { readonly oid?: unknown } | null;
      } | null;
    } | null;
  };
};

const readRemoteBranchHead = (
  runGh: PublicationCommandRunner,
  input: RemoteBranchCleanupInput,
): RemoteBranchHeadResult => {
  if (changeBranchNameForRef(input.canonicalBranchRef) !== input.branchName) {
    return { state: "mismatch" };
  }
  const remoteRepository = githubRepository(input.remoteUrl);
  if (
    remoteRepository === undefined ||
    remoteRepository.owner !== input.owner ||
    remoteRepository.repo !== input.repo
  ) {
    return { state: "mismatch" };
  }
  if (input.branchName === input.targetBranch) return { state: "excluded" };
  const result = runGh([
    "api",
    "graphql",
    "-f",
    `query=${remoteBranchQuery}`,
    "-f",
    `owner=${input.owner}`,
    "-f",
    `repo=${input.repo}`,
    "-f",
    `qualifiedName=refs/heads/${input.branchName}`,
  ]);
  if (!result.ok) return { state: "unavailable" };
  const parsed = parseJson(result.stdout);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    !("data" in parsed) ||
    hasGraphqlErrors(parsed)
  ) {
    return { state: "unavailable" };
  }
  const repository = (parsed as RemoteBranchQueryJson).data?.repository;
  if (repository === undefined) return { state: "unavailable" };
  if (repository === null) return { state: "mismatch" };
  const defaultBranch = repository.defaultBranchRef?.name;
  if (typeof defaultBranch !== "string") return { state: "unavailable" };
  if (defaultBranch === input.branchName) return { state: "excluded" };
  const ref = repository.ref;
  if (ref === null) return { state: "missing" };
  if (
    typeof repository.id !== "string" ||
    typeof ref?.id !== "string" ||
    typeof ref.target?.oid !== "string"
  ) {
    return { state: "unavailable" };
  }
  return {
    state: "present",
    headSha: ref.target.oid,
    remoteUrl: input.remoteUrl,
    repositoryId: repository.id,
    refId: ref.id,
  };
};

const deleteRemoteBranch = (
  runGh: PublicationCommandRunner,
  input: Parameters<ChangeCleanupRemote["deleteRemoteBranch"]>[0],
): RemoteBranchDeletionResult => {
  if (input.repositoryId === undefined || input.refId === undefined) {
    return { state: "failed" };
  }
  const result = runGh([
    "api",
    "graphql",
    "-f",
    `query=${remoteBranchDeletionMutation}`,
    "-F",
    `repositoryId=${input.repositoryId}`,
    "-F",
    `name=refs/heads/${input.branchName}`,
    "-F",
    `beforeOid=${input.expectedHeadSha}`,
    "-f",
    `afterOid=${zeroSha}`,
  ]);
  if (!result.ok) return readAfterUncertainDeletion(runGh, input);
  return decodeRemoteBranchDeletionResponse(parseJson(result.stdout))
    ? { state: "deleted" }
    : readAfterUncertainDeletion(runGh, input);
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const decodeRemoteBranchDeletionResponse = (value: unknown): boolean => {
  if (!isObjectRecord(value) || "errors" in value) return false;
  const data = value["data"];
  if (!isObjectRecord(data)) return false;
  const updateRefs = data["updateRefs"];
  if (!isObjectRecord(updateRefs) || !("clientMutationId" in updateRefs)) return false;
  return (
    updateRefs["clientMutationId"] === null || typeof updateRefs["clientMutationId"] === "string"
  );
};

const hasGraphqlErrors = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  "errors" in value &&
  Array.isArray(value.errors) &&
  value.errors.length > 0;

const readAfterUncertainDeletion = (
  runGh: PublicationCommandRunner,
  input: Parameters<ChangeCleanupRemote["deleteRemoteBranch"]>[0],
): RemoteBranchDeletionResult => {
  try {
    return readRemoteBranchHead(runGh, {
      repositoryCommonDirectory: input.repositoryCommonDirectory,
      owner: input.owner,
      repo: input.repo,
      remoteName: input.remoteName,
      remoteUrl: input.remoteUrl,
      branchName: input.branchName,
      canonicalBranchRef: input.canonicalBranchRef,
      targetBranch: input.targetBranch,
    });
  } catch {
    return { state: "unavailable" };
  }
};

const createPullRequest = (
  runGit: PublicationCommandRunner,
  runGh: PublicationCommandRunner,
  request: GitHubPullRequestRequest,
): ReturnType<GitHubPullRequestGateway["createPullRequest"]> => {
  const localHead = hasExpectedLocalHead(runGit, request);
  if (!localHead.ok) {
    return {
      ok: false,
      code: "local_head_mismatch",
      ...(localHead.evidence === undefined ? {} : { evidence: localHead.evidence }),
    };
  }
  const destination = resolvePushDestination(runGit, request);
  if (!destination.ok) return destination.failure;
  const remoteHead = initialRemoteHeadState(runGh, request);
  if (remoteHead.kind === "unknown")
    return {
      ok: false,
      code: "remote_lookup_failed",
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
    const pushed = pushExactHead(runGit, request, destination.url);
    if (!pushed.ok)
      return {
        ok: false,
        code: "push_failed",
        evidence: evidence("branch_push", pushed, classifyCommandFailure(pushed)),
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
  const localHead = hasExpectedLocalHead(runGit, request);
  if (!localHead.ok) {
    return {
      ok: false,
      code: "local_head_mismatch",
      ...(localHead.evidence === undefined ? {} : { evidence: localHead.evidence }),
    };
  }
  const destination = resolvePushDestination(runGit, request);
  if (!destination.ok) return destination.failure;
  const pushed = pushExpectedHead(runGit, request, destination.url);
  if (!pushed.ok)
    return {
      ok: false,
      code: "push_failed",
      evidence: evidence("branch_push", pushed, classifyCommandFailure(pushed)),
    };
  const result = runGh([
    "api",
    "--method",
    "PATCH",
    `repos/${request.owner}/${request.repo}/pulls/${request.number}`,
    "-f",
    "state=open",
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
): { readonly ok: boolean; readonly evidence?: ReturnType<typeof evidence> } => {
  const currentHead = runGit(["rev-parse", "--verify", `${request.branchRef}^{commit}`]);
  if (!currentHead.ok)
    return {
      ok: false,
      evidence: evidence("branch_push", currentHead, classifyCommandFailure(currentHead)),
    };
  return { ok: currentHead.stdout.trim() === request.expectedHeadSha };
};

const initialRemoteHeadState = (
  runGh: PublicationCommandRunner,
  request: GitHubPullRequestRequest,
): {
  readonly kind: "missing" | "present" | "unknown";
  readonly sha?: string;
  readonly evidence?: ReturnType<typeof evidence>;
} => {
  const qualifiedName = `refs/heads/${request.headBranch}`;
  const result = runGh([
    "api",
    "graphql",
    "-f",
    `query=${publicationRemoteBranchQuery}`,
    "-f",
    `owner=${request.owner}`,
    "-f",
    `repo=${request.repo}`,
    "-f",
    `qualifiedName=${qualifiedName}`,
  ]);
  if (!result.ok)
    return {
      kind: "unknown",
      evidence: evidence("remote_lookup", result, classifyCommandFailure(result)),
    };
  const parsed = parseJson(result.stdout);
  if (!isObjectRecord(parsed) || "errors" in parsed)
    return {
      kind: "unknown",
      evidence: evidence("remote_lookup", result, "response_parse_failure"),
    };
  const data = parsed["data"];
  if (!isObjectRecord(data))
    return {
      kind: "unknown",
      evidence: evidence("remote_lookup", result, "response_parse_failure"),
    };
  const repository = data["repository"];
  if (!isObjectRecord(repository))
    return {
      kind: "unknown",
      evidence: evidence("remote_lookup", result, "response_parse_failure"),
    };
  const ref = repository["ref"];
  if (ref === null) return { kind: "missing" };
  if (!isObjectRecord(ref) || ref["name"] !== request.headBranch || ref["prefix"] !== "refs/heads/")
    return {
      kind: "unknown",
      evidence: evidence("remote_lookup", result, "response_parse_failure"),
    };
  const target = ref["target"];
  if (!isObjectRecord(target) || typeof target["oid"] !== "string")
    return {
      kind: "unknown",
      evidence: evidence("remote_lookup", result, "response_parse_failure"),
    };
  const oid = target["oid"];
  if (oid !== request.expectedHeadSha && !/^[0-9a-f]{40}$/u.test(oid))
    return {
      kind: "unknown",
      evidence: evidence("remote_lookup", result, "response_parse_failure"),
    };
  return { kind: "present", sha: oid };
};

type PushDestinationFailureReason =
  | "unavailable"
  | "destination_count"
  | "credentials"
  | "malformed"
  | "repository_mismatch";

type PushDestinationResult =
  | { readonly ok: true; readonly url: string }
  | {
      readonly ok: false;
      readonly failure: Exclude<GitHubPullRequestMutationResult, { readonly ok: true }>;
    };

const resolvePushDestination = (
  runGit: PublicationCommandRunner,
  request: GitHubPullRequestRequest,
): PushDestinationResult => {
  const result = runGit(["remote", "get-url", "--push", "--all", request.remoteName]);
  if (!result.ok)
    return pushDestinationFailure("unavailable", {
      ...(result.status === undefined ? {} : { exitStatus: result.status }),
    });
  const destinations = result.stdout.split(/\r?\n/u).filter((value) => value.length > 0);
  if (destinations.length !== 1)
    return pushDestinationFailure("destination_count", {
      destinationCount: Math.min(destinations.length, 1000),
    });
  const decoded = decodeGitHubPushDestination(destinations[0] ?? "");
  if (!decoded.ok) return pushDestinationFailure(decoded.reason);
  if (
    decoded.owner.toLowerCase() !== request.owner.toLowerCase() ||
    decoded.repo.toLowerCase() !== request.repo.toLowerCase()
  )
    return pushDestinationFailure("repository_mismatch", {
      destinationOwner: decoded.owner.slice(0, 100),
      destinationRepo: decoded.repo.slice(0, 100),
    });
  return { ok: true, url: destinations[0] ?? "" };
};

const pushDestinationFailure = (
  reason: PushDestinationFailureReason,
  facts: {
    readonly exitStatus?: number;
    readonly destinationCount?: number;
    readonly destinationOwner?: string;
    readonly destinationRepo?: string;
  } = {},
): PushDestinationResult => ({
  ok: false,
  failure: {
    ok: false,
    code: "push_destination_failed",
    evidence: {
      operation: "push_destination",
      classification: reason === "unavailable" ? "unavailable" : "rejected",
      reason,
      ...facts,
    },
  },
});

const decodeGitHubPushDestination = (
  value: string,
):
  | { readonly ok: true; readonly owner: string; readonly repo: string }
  | { readonly ok: false; readonly reason: "credentials" | "malformed" } => {
  const scp = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/u.exec(value);
  if (scp !== null)
    return scp[1]?.length && scp[2]?.length
      ? { ok: true, owner: scp[1], repo: scp[2] }
      : { ok: false, reason: "malformed" };
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const isHttps = parsed.protocol === "https:" && parsed.username === "";
  const isSsh = parsed.protocol === "ssh:" && parsed.username === "git";
  if (parsed.password !== "" || (!isHttps && !isSsh && parsed.username !== ""))
    return { ok: false, reason: "credentials" };
  if (
    parsed.hostname.toLowerCase() !== "github.com" ||
    (!isHttps && !isSsh) ||
    parsed.port !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  )
    return { ok: false, reason: "malformed" };
  const parts = parsed.pathname.replace(/^\//u, "").replace(/\/$/u, "").split("/");
  const owner = parts[0] ?? "";
  const repo = (parts[1] ?? "").replace(/\.git$/u, "");
  return parts.length === 2 && owner.length > 0 && repo.length > 0
    ? { ok: true, owner, repo }
    : { ok: false, reason: "malformed" };
};

const pushExactHead = (
  runGit: PublicationCommandRunner,
  request: GitHubPullRequestRequest,
  destination: string,
): PublicationCommandResult =>
  runGit([
    "-c",
    `url.${destination}.pushInsteadOf=${destination}`,
    "push",
    `--force-with-lease=refs/heads/${request.headBranch}:`,
    destination,
    `${request.expectedHeadSha}:refs/heads/${request.headBranch}`,
  ]);

const pushExpectedHead = (
  runGit: PublicationCommandRunner,
  request: Parameters<GitHubPullRequestGateway["updatePullRequest"]>[0],
  destination: string,
): PublicationCommandResult =>
  runGit([
    "-c",
    `url.${destination}.pushInsteadOf=${destination}`,
    "push",
    `--force-with-lease=refs/heads/${request.headBranch}:${request.expectedCurrentHeadSha}`,
    destination,
    `${request.expectedHeadSha}:refs/heads/${request.headBranch}`,
  ]);

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
        ...(result.stdout === undefined ? {} : { stdout: result.stdout }),
        ...(result.stderr === undefined ? {} : { stderr: result.stderr }),
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
