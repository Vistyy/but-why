import { Effect } from "effect";

import type { RepositoryStorageError } from "../repositoryStorageError.js";
import type { ChangeCleanup, ChangeOwnedPullRequest, ChangeRecord } from "./change.js";
import type { ChangePersistence } from "./changePersistence.js";
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

export type ChangeCleanupOperationResult =
  | { readonly state: "complete" }
  | { readonly state: "pending"; readonly blockingReason: string };

export type ChangeReconciliationResult = {
  readonly changes: readonly ReconciledChange[];
  readonly rejected: boolean;
};

export type ChangeReconciliation = {
  readonly reconcile: (input: {
    readonly repositoryCommonDirectory: string;
    readonly changeId?: string;
    readonly now: string;
  }) => Effect.Effect<ChangeReconciliationResult, RepositoryStorageError>;
};

export const openChangeReconciliation = (input: {
  readonly persistence: ChangePersistence;
  readonly github: GitHubPullRequestGateway;
  readonly cleanup: (input: {
    readonly repositoryCommonDirectory: string;
    readonly worktreePath: string | null;
    readonly branchRef: string;
  }) => ChangeCleanupOperationResult;
}): ChangeReconciliation => ({
  reconcile: (reconciliationInput) => reconcile(input, reconciliationInput),
});

const reconcile = (
  dependencies: Parameters<typeof openChangeReconciliation>[0],
  input: Parameters<ChangeReconciliation["reconcile"]>[0],
): Effect.Effect<ChangeReconciliationResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const changes =
      input.changeId === undefined
        ? yield* dependencies.persistence.listChangesForReconciliation(
            input.repositoryCommonDirectory,
          )
        : [yield* dependencies.persistence.getChangeById(input.changeId)].filter(
            (change): change is ChangeRecord => change !== undefined,
          );
    const reconciled = yield* Effect.forEach(changes, (change) =>
      reconcileOne(dependencies, change, input.now),
    );
    return {
      changes: reconciled,
      rejected: reconciled.some((change) => change.status === "rejected"),
    };
  });

const reconcileOne = (
  dependencies: Parameters<typeof openChangeReconciliation>[0],
  change: ChangeRecord,
  now: string,
): Effect.Effect<ReconciledChange, RepositoryStorageError> =>
  Effect.gen(function* () {
    if (change.state === "closed") return yield* reconcileCleanup(dependencies, change, now);
    const observation = observePullRequest(dependencies.github, change);
    if (!observation.merged) return observation.result;

    const completed = yield* dependencies.persistence.completeMergedChange({
      changeId: change.id,
      now,
    });
    if (!completed.ok) return rejected(change.id, completed.code);
    const cleanup = yield* reconcileCleanup(dependencies, completed.change, now);
    return { ...cleanup, status: "completed", pullRequest: observation.pullRequest };
  });

type MergedPullRequestObservation = {
  readonly merged: true;
  readonly pullRequest: ChangeOwnedPullRequest;
};
type PullRequestObservation =
  | MergedPullRequestObservation
  | { readonly merged: false; readonly result: ReconciledChange };

const observePullRequest = (
  github: GitHubPullRequestGateway,
  change: ChangeRecord,
): PullRequestObservation => {
  const publication = ownedPublication(change);
  if (publication === undefined) {
    return { merged: false, result: { changeId: change.id, status: "not_owned" } };
  }
  const pullRequest = readPullRequest(github, change, publication.pullRequest.number);
  if (!pullRequest.ok) return { merged: false, result: pullRequest.result };
  const mismatch = unexpectedPullRequestFact(change, pullRequest.pullRequest);
  if (mismatch !== undefined) {
    return { merged: false, result: rejected(change.id, mismatch) };
  }
  return classifyMatchedPullRequest(change.id, publication.pullRequest, pullRequest.pullRequest);
};

const ownedPublication = (
  change: ChangeRecord,
):
  | (NonNullable<ChangeRecord["publication"]> & {
      readonly pullRequest: ChangeOwnedPullRequest;
    })
  | undefined => {
  const publication = change.publication;
  return publication?.pullRequest === null || publication === null
    ? undefined
    : (publication as NonNullable<ChangeRecord["publication"]> & {
        readonly pullRequest: ChangeOwnedPullRequest;
      });
};

const readPullRequest = (
  github: GitHubPullRequestGateway,
  change: ChangeRecord,
  pullRequestNumber: number,
):
  | { readonly ok: true; readonly pullRequest: GitHubPullRequest }
  | { readonly ok: false; readonly result: ReconciledChange } => {
  let pullRequest: GitHubPullRequest | undefined;
  try {
    const publication = change.publication;
    if (publication === null) throw new Error("Missing owned publication");
    pullRequest = github.getPullRequest(publication.target, pullRequestNumber);
  } catch {
    return { ok: false, result: rejected(change.id, "github_unavailable") };
  }
  return pullRequest === undefined
    ? { ok: false, result: rejected(change.id, "pull_request_unavailable") }
    : { ok: true, pullRequest };
};

const classifyMatchedPullRequest = (
  changeId: string,
  ownedPullRequest: ChangeOwnedPullRequest,
  pullRequest: GitHubPullRequest,
): PullRequestObservation => {
  const state = `${pullRequest.state}:${String(pullRequest.merged)}`;
  if (state === "open:false") {
    return { merged: false, result: { changeId, status: "open", pullRequest: ownedPullRequest } };
  }
  if (state === "closed:false") {
    return {
      merged: false,
      result: { changeId, status: "closed_unmerged", pullRequest: ownedPullRequest },
    };
  }
  return state === "closed:true"
    ? { merged: true, pullRequest: ownedPullRequest }
    : { merged: false, result: rejected(changeId, "pull_request_state_invalid") };
};

const reconcileCleanup = (
  dependencies: Parameters<typeof openChangeReconciliation>[0],
  change: ChangeRecord,
  now: string,
): Effect.Effect<ReconciledChange, RepositoryStorageError> =>
  Effect.gen(function* () {
    if (change.cleanup.state === "complete") {
      return { changeId: change.id, status: "cleanup_complete", cleanup: change.cleanup };
    }
    const result = dependencies.cleanup({
      repositoryCommonDirectory: change.repositoryCommonDirectory,
      worktreePath: change.worktreePath,
      branchRef: change.branchRef,
    });
    const cleanup = cleanupRecord(result);
    const recorded = yield* dependencies.persistence.recordCleanup({
      changeId: change.id,
      cleanup,
      now,
    });
    if (!recorded.ok) return rejected(change.id, recorded.code);
    return {
      changeId: change.id,
      status: cleanupStatus(cleanup),
      cleanup: recorded.change.cleanup,
    };
  });

const cleanupRecord = (result: ChangeCleanupOperationResult): ChangeCleanup =>
  result.state === "complete"
    ? { state: "complete", blockingReason: null }
    : { state: "pending", blockingReason: result.blockingReason };

const cleanupStatus = (cleanup: ChangeCleanup): "cleanup_complete" | "cleanup_pending" =>
  cleanup.state === "complete" ? "cleanup_complete" : "cleanup_pending";

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
