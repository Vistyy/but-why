import type { SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { spawnSync } from "node:child_process";

import type { ChangePublicationTarget } from "../../change/change.js";
import { changeBranchNameForRef } from "../../change/changeBranch.js";
import type {
  ChangeCleanupRemote,
  RemoteBranchDeletionResult,
  RemoteBranchHeadResult,
} from "../../change/changeCleanupRemote.js";
import type {
  GitHubPullRequestCloser,
  GitHubPullRequestCoordinates,
  GitHubPullRequestCreationRequest,
  GitHubPullRequestGateway,
  GitHubPullRequestMutationResult,
  PublicationFailureEvidence,
} from "../../change/ownedPullRequestGateway.js";
import {
  decodeGitHubPullRequest,
  decodeGitHubPullRequestList,
  decodePublicationRemoteBranchQuery,
  decodeRemoteBranchQuery,
  isConfirmedRemoteBranchDeletion,
} from "./githubResponseContracts.js";

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
    | "pull_request_update"
    | "pull_request_close",
  result: PublicationCommandResult,
  classification: "rejected" | "lost_response" | "response_parse_failure" | "unavailable",
  _parseFailure?: string,
) => ({
  operation,
  classification,
  ...(result.status === undefined ? {} : { exitStatus: result.status }),
});

export type PublicationCommandRunner = (args: readonly string[]) => PublicationCommandResult;

export const localGitHubChangeCleanupRemote = (
  input: { readonly cwd?: string; readonly runGh?: PublicationCommandRunner } = {},
): ChangeCleanupRemote => {
  const runGh = input.runGh ?? ((args) => runCommand("gh", args, input.cwd));
  return {
    readRemoteBranchHead: (cleanupInput) => readRemoteBranchHead(runGh, cleanupInput),
    deleteRemoteBranch: (cleanupInput) => deleteRemoteBranch(runGh, cleanupInput),
  };
};

export const localGitHubPullRequestGateway = (
  input: {
    readonly cwd?: string;
    readonly runGit?: PublicationCommandRunner;
    readonly runGh?: PublicationCommandRunner;
  } = {},
): GitHubPullRequestGateway & GitHubPullRequestCloser => {
  const runGit = input.runGit ?? ((args) => runCommand("git", args, input.cwd));
  const runGh = input.runGh ?? ((args) => runCommand("gh", args, input.cwd));

  return {
    findPullRequests: (target, headBranch) => findPullRequests(runGh, target, headBranch),
    getPullRequest: (target, number) => getPullRequest(runGh, target, number),
    closePullRequest: (closeInput) => closePullRequest(runGh, closeInput),
    createPullRequest: (request) => createPullRequest(runGit, runGh, request),
    updatePullRequest: (request) => updatePullRequest(runGit, runGh, request),
  };
};

const findPullRequests = (
  runGh: PublicationCommandRunner,
  target: ChangePublicationTarget,
  headBranch: string,
): ReturnType<GitHubPullRequestGateway["findPullRequests"]> => {
  const query = new URLSearchParams({
    state: "open",
    head: `${target.owner}:${headBranch}`,
    base: target.baseBranch,
  });
  const result = runGh(["api", `repos/${target.owner}/${target.repo}/pulls?${query}`]);
  if (!result.ok) {
    return {
      ok: false,
      evidence: evidence("remote_lookup", result, classifyCommandFailure(result)),
    };
  }
  const parsed = decodeGitHubPullRequestList(result.stdout);
  return parsed === undefined
    ? {
        ok: false,
        evidence: evidence("remote_lookup", result, "response_parse_failure"),
      }
    : { ok: true, pullRequests: parsed };
};

const getPullRequest = (
  runGh: PublicationCommandRunner,
  target: ChangePublicationTarget,
  number: number,
): ReturnType<GitHubPullRequestGateway["getPullRequest"]> => {
  const result = runGh(["api", `repos/${target.owner}/${target.repo}/pulls/${number}`]);
  if (!result.ok) {
    return {
      ok: false,
      evidence: evidence("remote_lookup", result, classifyCommandFailure(result)),
    };
  }
  const parsed = decodeGitHubPullRequest(result.stdout);
  return parsed === undefined
    ? {
        ok: false,
        evidence: evidence("remote_lookup", result, "response_parse_failure"),
      }
    : { ok: true, pullRequest: parsed };
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
  if (!result.ok) {
    const lost =
      result.status === undefined && result.stdout === undefined && result.stderr === undefined;
    return {
      ok: false,
      code: "close_failed",
      evidence: evidence("pull_request_close", result, lost ? "lost_response" : "rejected"),
    };
  }
  const pullRequest = decodeGitHubPullRequest(result.stdout);
  return pullRequest === undefined
    ? {
        ok: false,
        code: "close_failed",
        evidence: evidence("pull_request_close", result, "response_parse_failure"),
      }
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
  const parsed = decodeRemoteBranchQuery(result.stdout);
  if (parsed === undefined || (parsed.errors !== undefined && parsed.errors.length > 0)) {
    return { state: "unavailable" };
  }
  const repository = parsed.data.repository;
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
  return isConfirmedRemoteBranchDeletion(result.stdout)
    ? { state: "deleted" }
    : readAfterUncertainDeletion(runGh, input);
};

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
  request: GitHubPullRequestCreationRequest,
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
    if (!pushed.ok) {
      const reconciled = reconcilePushFailure(runGh, request, pushed);
      if (!reconciled.ok) return reconciled;
    }
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
  const pullRequest = decodeGitHubPullRequest(result.stdout);
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
  let pushRequired = true;
  if (request.allowExistingRemoteHead) {
    const remoteHead = initialRemoteHeadState(runGh, request);
    if (remoteHead.kind === "unknown")
      return {
        ok: false,
        code: "remote_lookup_failed",
        ...(remoteHead.evidence === undefined ? {} : { evidence: remoteHead.evidence }),
      };
    if (remoteHead.kind !== "present" || remoteHead.sha === undefined)
      return { ok: false, code: "remote_head_mismatch" };
    if (remoteHead.sha === request.expectedHeadSha) {
      pushRequired = false;
    } else if (remoteHead.sha !== request.expectedCurrentHeadSha) {
      return {
        ok: false,
        code: "remote_head_mismatch",
        observedRemoteHeadSha: remoteHead.sha,
      };
    }
  }
  if (pushRequired) {
    const destination = resolvePushDestination(runGit, request);
    if (!destination.ok) return destination.failure;
    const pushed = pushExpectedHead(runGit, request, destination.url);
    if (!pushed.ok) {
      const reconciled = reconcilePushFailure(
        runGh,
        request,
        pushed,
        request.expectedCurrentHeadSha,
      );
      if (!reconciled.ok) return reconciled;
    }
  }
  const result = runGh([
    "api",
    "--method",
    "PATCH",
    `repos/${request.owner}/${request.repo}/pulls/${request.number}`,
    "-f",
    "state=open",
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
  const pullRequest = decodeGitHubPullRequest(result.stdout);
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
  request: GitHubPullRequestCoordinates,
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
  request: GitHubPullRequestCoordinates,
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
  const parsed = decodePublicationRemoteBranchQuery(result.stdout);
  if (parsed === undefined || parsed.errors !== undefined)
    return {
      kind: "unknown",
      evidence: evidence("remote_lookup", result, "response_parse_failure"),
    };
  const ref = parsed.data.repository.ref;
  if (ref === null) return { kind: "missing" };
  if (ref.name !== request.headBranch || ref.prefix !== "refs/heads/")
    return {
      kind: "unknown",
      evidence: evidence("remote_lookup", result, "response_parse_failure"),
    };
  const oid = ref.target.oid;
  if (oid !== request.expectedHeadSha && !/^[0-9a-f]{40}$/u.test(oid))
    return {
      kind: "unknown",
      evidence: evidence("remote_lookup", result, "response_parse_failure"),
    };
  return { kind: "present", sha: oid };
};

type PushFailure = Exclude<GitHubPullRequestMutationResult, { readonly ok: true }>;

type PushRecoveryResult = { readonly ok: true } | PushFailure;

const reconcilePushFailure = (
  runGh: PublicationCommandRunner,
  request: GitHubPullRequestCoordinates,
  pushed: PublicationCommandResult,
  expectedCurrentHeadSha?: string,
): PushRecoveryResult => {
  const remoteHead = initialRemoteHeadState(runGh, request);
  if (remoteHead.kind === "unknown") {
    return {
      ok: false,
      code: "push_failed",
      evidence: evidence("branch_push", pushed, classifyCommandFailure(pushed)),
      recoveryEvidence: remoteBranchRecoveryEvidence("unavailable", remoteHead.evidence),
    };
  }
  if (remoteHead.kind === "present" && remoteHead.sha === request.expectedHeadSha) {
    return { ok: true };
  }
  if (remoteHead.kind === "missing" && expectedCurrentHeadSha === undefined) {
    return {
      ok: false,
      code: "push_failed",
      evidence: evidence("branch_push", pushed, classifyCommandFailure(pushed)),
      recoveryEvidence: remoteBranchRecoveryEvidence("retryable_absence"),
    };
  }
  if (
    remoteHead.kind === "present" &&
    expectedCurrentHeadSha !== undefined &&
    remoteHead.sha === expectedCurrentHeadSha
  ) {
    return {
      ok: false,
      code: "push_failed",
      evidence: evidence("branch_push", pushed, classifyCommandFailure(pushed)),
      recoveryEvidence: remoteBranchRecoveryEvidence("retained_prior_head"),
      observedRemoteHeadSha: remoteHead.sha,
    };
  }
  return {
    ok: false,
    code: "remote_head_mismatch",
    evidence: evidence("branch_push", pushed, classifyCommandFailure(pushed)),
    recoveryEvidence: remoteBranchRecoveryEvidence("unexpected_head"),
    ...(remoteHead.sha === undefined ? {} : { observedRemoteHeadSha: remoteHead.sha }),
  };
};

const remoteBranchRecoveryEvidence = (
  remoteBranchState: NonNullable<PublicationFailureEvidence["remoteBranchState"]>,
  observed?: PublicationFailureEvidence,
): PublicationFailureEvidence => ({
  ...(observed === undefined ? {} : observed),
  operation: "remote_lookup",
  classification: remoteBranchState === "unavailable" ? "unavailable" : "conflict",
  remoteBranchState,
});

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
  request: GitHubPullRequestCoordinates,
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
  request: GitHubPullRequestCoordinates,
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
