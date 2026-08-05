import { Effect } from "effect";

import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type {
  ChangeCleanup,
  ChangeOwnedPullRequest,
  ChangeRecord,
  RemoteChangeBranch,
} from "./change.js";
import type { ChangePersistence } from "./changePersistence.js";
import type { GitHubPullRequestGateway } from "./ownedPullRequestGateway.js";
import { observeOwnedPullRequest } from "./ownedPullRequestClassifier.js";

export type ReconciledChange = {
  readonly changeId: string;
  readonly status:
    | "open"
    | "completed"
    | "closed_unmerged"
    | "cleanup_complete"
    | "cleanup_pending"
    | "not_owned"
    | "rejected"
    | "unavailable";
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
    readonly remoteChangeBranch?: RemoteChangeBranch;
    readonly reviewerSessionPath?: string;
  }) => ChangeCleanupOperationResult;
  readonly reviewerSessionPathFor?: (changeId: string) => string;
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
    const classification = observeOwnedPullRequest(dependencies.github, change);
    switch (classification.kind) {
      case "not_owned":
        return { changeId: change.id, status: "not_owned" };
      case "exact_open":
        return {
          changeId: change.id,
          status: "open",
          pullRequest: ownedIdentity(classification.pullRequest),
        };
      case "exact_closed_unmerged":
        return {
          changeId: change.id,
          status: "closed_unmerged",
          pullRequest: ownedIdentity(classification.pullRequest),
        };
      case "exact_merged": {
        const completed = yield* dependencies.persistence.completeMergedChange({
          changeId: change.id,
          now,
        });
        if (!completed.ok) return rejected(change.id, completed.code);
        const cleanup = yield* reconcileCleanup(dependencies, completed.change, now);
        return {
          ...cleanup,
          status: "completed",
          pullRequest: ownedIdentity(classification.pullRequest),
        };
      }
      case "mismatch":
        return rejected(change.id, classification.rejection);
      case "unavailable":
        return { changeId: change.id, status: "unavailable", rejection: classification.reason };
    }
  });

const reconcileCleanup = (
  dependencies: Parameters<typeof openChangeReconciliation>[0],
  change: ChangeRecord,
  now: string,
): Effect.Effect<ReconciledChange, RepositoryStorageError> =>
  Effect.gen(function* () {
    if (change.cleanup.state === "complete") {
      return { changeId: change.id, status: "cleanup_complete", cleanup: change.cleanup };
    }
    const remoteChangeBranch = remoteChangeBranchFor(change);
    const result = dependencies.cleanup({
      repositoryCommonDirectory: change.repositoryCommonDirectory,
      worktreePath: change.worktreePath,
      branchRef: change.branchRef,
      ...(remoteChangeBranch === undefined ? {} : { remoteChangeBranch }),
      ...(dependencies.reviewerSessionPathFor === undefined
        ? {}
        : { reviewerSessionPath: dependencies.reviewerSessionPathFor(change.id) }),
    });
    const cleanup = cleanupRecord(result);
    const recorded = yield* dependencies.persistence.recordCleanup({
      changeId: change.id,
      cleanup,
      now,
    });
    if (!recorded.ok) return rejected(change.id, recorded.code);
    if (cleanup.state === "complete")
      yield* dependencies.persistence.removeReviewerSessions(change.id);
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

const remoteChangeBranchFor = (change: ChangeRecord) => {
  const publication = change.publication;
  return change.closeReason === "completed" &&
    publication !== null &&
    publication.pullRequest !== null
    ? {
        owner: publication.target.owner,
        repo: publication.target.repo,
        remoteName: publication.target.remoteName,
        remoteUrl: change.baseRemoteUrl ?? "",
        branchName: publication.headBranch,
        targetBranch: publication.target.baseBranch,
        expectedHeadSha: publication.expectedHeadSha,
      }
    : undefined;
};

const rejected = (changeId: string, rejection: string): ReconciledChange => ({
  changeId,
  status: "rejected",
  rejection,
});

const ownedIdentity = (pullRequest: { readonly number: number; readonly url: string }) => ({
  number: pullRequest.number,
  url: pullRequest.url,
});
