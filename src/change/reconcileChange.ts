import type { ChangeCleanup, ChangeOwnedPullRequest, ChangeRecord } from "./change.js";
import type { ChangeStore } from "./changeStore.js";
import type { ChangeCleanupResult } from "./localChangeCleanupGit.js";
import type { GitHubPullRequest, GitHubPullRequestGateway } from "./ownedPullRequestGateway.js";

export type ReconciledChange = {
  readonly changeId: string;
  readonly status:
    | "open"
    | "completed"
    | "closed_unmerged"
    | "cleanup_complete"
    | "cleanup_pending"
    | "not_owned"
    | "rejected";
  readonly pullRequest?: ChangeOwnedPullRequest;
  readonly cleanup?: ChangeCleanup;
  readonly rejection?: string;
};

export type ChangeReconciliationResult = {
  readonly changes: readonly ReconciledChange[];
  readonly rejected: boolean;
};

export type ChangeReconciliation = {
  readonly reconcile: (input: {
    readonly repositoryCommonDirectory: string;
    readonly changeId?: string;
    readonly now: string;
  }) => ChangeReconciliationResult;
};

export const openChangeReconciliation = (input: {
  readonly changeStore: ChangeStore;
  readonly github: GitHubPullRequestGateway;
  readonly cleanup: (input: {
    readonly repositoryCommonDirectory: string;
    readonly worktreePath: string | null;
    readonly branchRef: string;
  }) => ChangeCleanupResult;
}): ChangeReconciliation => ({
  reconcile: (reconciliationInput) => reconcile(input, reconciliationInput),
});

const reconcile = (
  dependencies: Parameters<typeof openChangeReconciliation>[0],
  input: Parameters<ChangeReconciliation["reconcile"]>[0],
): ChangeReconciliationResult => {
  const changes =
    input.changeId === undefined
      ? dependencies.changeStore.listChangesForReconciliation(input.repositoryCommonDirectory)
      : [dependencies.changeStore.getChangeById(input.changeId)].filter(
          (change): change is ChangeRecord => change !== undefined,
        );
  const reconciled = changes.map((change) => reconcileOne(dependencies, change, input.now));
  return {
    changes: reconciled,
    rejected: reconciled.some((change) => change.status === "rejected"),
  };
};

const reconcileOne = (
  dependencies: Parameters<typeof openChangeReconciliation>[0],
  change: ChangeRecord,
  now: string,
): ReconciledChange => {
  if (change.state === "closed") return reconcileCleanup(dependencies, change, now);
  if (change.publication?.pullRequest === null || change.publication === null) {
    return { changeId: change.id, status: "not_owned" };
  }

  let pullRequest: GitHubPullRequest | undefined;
  try {
    pullRequest = dependencies.github.getPullRequest(
      change.publication.target,
      change.publication.pullRequest.number,
    );
  } catch {
    return rejected(change.id, "github_unavailable");
  }
  if (pullRequest === undefined) return rejected(change.id, "pull_request_unavailable");

  const mismatch = unexpectedPullRequestFact(change, pullRequest);
  if (mismatch !== undefined) return rejected(change.id, mismatch);
  const ownedPullRequest = change.publication.pullRequest;
  if (pullRequest.state === "open" && pullRequest.merged === false) {
    return { changeId: change.id, status: "open", pullRequest: ownedPullRequest };
  }
  if (pullRequest.state === "closed" && pullRequest.merged === false) {
    return { changeId: change.id, status: "closed_unmerged", pullRequest: ownedPullRequest };
  }
  if (pullRequest.state !== "closed" || pullRequest.merged !== true) {
    return rejected(change.id, "pull_request_state_invalid");
  }

  const completed = dependencies.changeStore.completeMergedChange({ changeId: change.id, now });
  if (!completed.ok) return rejected(change.id, completed.code);
  const cleanup = reconcileCleanup(dependencies, completed.change, now);
  return { ...cleanup, status: "completed", pullRequest: ownedPullRequest };
};

const reconcileCleanup = (
  dependencies: Parameters<typeof openChangeReconciliation>[0],
  change: ChangeRecord,
  now: string,
): ReconciledChange => {
  if (change.cleanup.state === "complete") {
    return { changeId: change.id, status: "cleanup_complete", cleanup: change.cleanup };
  }
  const result = dependencies.cleanup({
    repositoryCommonDirectory: change.repositoryCommonDirectory,
    worktreePath: change.worktreePath,
    branchRef: change.branchRef,
  });
  const cleanup: ChangeCleanup =
    result.state === "complete"
      ? { state: "complete", blockingReason: null }
      : { state: "pending", blockingReason: result.blockingReason };
  const recorded = dependencies.changeStore.recordCleanup({ changeId: change.id, cleanup, now });
  if (!recorded.ok) return rejected(change.id, recorded.code);
  return {
    changeId: change.id,
    status: cleanup.state === "complete" ? "cleanup_complete" : "cleanup_pending",
    cleanup: recorded.change.cleanup,
  };
};

const unexpectedPullRequestFact = (
  change: ChangeRecord,
  pullRequest: GitHubPullRequest,
): string | undefined => {
  const publication = change.publication;
  if (publication === null || publication.pullRequest === null) return "publication_not_owned";
  const repository = pullRequest.repository;
  if (
    repository === undefined ||
    repository.owner !== publication.target.owner ||
    repository.repo !== publication.target.repo
  ) {
    return "repository_mismatch";
  }
  if (pullRequest.baseBranch !== publication.target.baseBranch) return "base_branch_mismatch";
  if (pullRequest.headBranch !== publication.headBranch) return "head_branch_mismatch";
  if (pullRequest.headSha !== publication.expectedHeadSha) return "head_sha_mismatch";
  if (pullRequest.state === undefined || pullRequest.merged === undefined) {
    return "pull_request_facts_unavailable";
  }
  return undefined;
};

const rejected = (changeId: string, rejection: string): ReconciledChange => ({
  changeId,
  status: "rejected",
  rejection,
});
