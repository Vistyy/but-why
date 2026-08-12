import { Effect } from "effect";

import type { ExecutionLock } from "../contracts/executionLock.js";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type { ChangeCleanup, ChangeOwnedPullRequest } from "./change.js";
import type { ChangeReconciliationPort, ReconciliationChange } from "./changePorts.js";
import type { TerminalCleanupOperation } from "./cleanupTerminalChange.js";
import {
  observedMergedChangeEvidence,
  observeOwnedPullRequest,
} from "./ownedPullRequestClassifier.js";
import type { GitHubPullRequestReader } from "./ownedPullRequestGateway.js";

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
    | "submission_in_progress"
    | "unavailable";
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
    readonly discardWork?: boolean;
  }) => Effect.Effect<ChangeReconciliationResult, RepositoryStorageError>;
};

export const openChangeReconciliation = (input: {
  readonly persistence: ChangeReconciliationPort;
  readonly github: GitHubPullRequestReader;
  readonly cleanupTerminal: TerminalCleanupOperation;
  readonly executionLock: ExecutionLock;
}): ChangeReconciliation => ({
  reconcile: (reconciliationInput) => reconcile(input, reconciliationInput),
});

const reconcile = (
  dependencies: Parameters<typeof openChangeReconciliation>[0],
  input: Parameters<ChangeReconciliation["reconcile"]>[0],
): Effect.Effect<ChangeReconciliationResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const discardWork = input.discardWork === true;
    const changes =
      input.changeId === undefined
        ? yield* dependencies.persistence.listChangesForReconciliation(
            input.repositoryCommonDirectory,
          )
        : [yield* dependencies.persistence.getChangeById(input.changeId)].filter(
            (change): change is ReconciliationChange => change !== undefined,
          );
    const reconciled = yield* Effect.forEach(changes, (selected) =>
      reconcileSelected(dependencies, selected.id, input.now, discardWork),
    );
    return {
      changes: reconciled,
      rejected: reconciled.some((change) => change.status === "rejected"),
    };
  });

const reconcileSelected = (
  dependencies: Parameters<typeof openChangeReconciliation>[0],
  changeId: string,
  now: string,
  discardWork: boolean,
): Effect.Effect<ReconciledChange, RepositoryStorageError> =>
  dependencies.executionLock
    .withLock({
      owner: "change_submission",
      key: changeId,
      effect: Effect.gen(function* () {
        const change = yield* dependencies.persistence.getChangeById(changeId);
        if (change === undefined) return rejected(changeId, "change_not_found");
        return yield* reconcileOne(dependencies, change, now, discardWork);
      }),
    })
    .pipe(
      Effect.catchTag("ExecutionLockUnavailable", () =>
        Effect.succeed({ changeId, status: "submission_in_progress" } as const),
      ),
    );

const reconcileOne = (
  dependencies: Parameters<typeof openChangeReconciliation>[0],
  change: ReconciliationChange,
  now: string,
  discardWork: boolean,
): Effect.Effect<ReconciledChange, RepositoryStorageError> =>
  Effect.gen(function* () {
    if (discardWork && change.state !== "closed") {
      return rejected(change.id, "discard_open_change");
    }
    if (change.state === "closed")
      return yield* reconcileCleanup(dependencies, change, now, discardWork);
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
        const observed = observedMergedChangeEvidence(change, classification.pullRequest);
        if (observed === undefined) return rejected(change.id, "missing_publication_facts");
        const completed = yield* dependencies.persistence.completeMergedChange({
          changeId: change.id,
          now,
          observed,
        });
        if (!completed.ok) return rejected(change.id, completed.code);
        const cleanup = yield* reconcileCleanup(dependencies, completed.change, now, discardWork);
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
  change: ReconciliationChange,
  now: string,
  discardWork: boolean,
): Effect.Effect<ReconciledChange, RepositoryStorageError> =>
  Effect.gen(function* () {
    if (change.cleanup.state === "complete") {
      return { changeId: change.id, status: "cleanup_complete", cleanup: change.cleanup };
    }
    const result = yield* dependencies.cleanupTerminal(change, now, discardWork);
    if (!result.ok) return rejected(change.id, result.code);
    return {
      changeId: change.id,
      status: cleanupStatus(result.cleanup),
      cleanup: result.cleanup,
    };
  });

const cleanupStatus = (cleanup: ChangeCleanup): "cleanup_complete" | "cleanup_pending" =>
  cleanup.state === "complete" ? "cleanup_complete" : "cleanup_pending";

const rejected = (changeId: string, rejection: string): ReconciledChange => ({
  changeId,
  status: "rejected",
  rejection,
});

const ownedIdentity = (pullRequest: { readonly number: number; readonly url: string }) => ({
  number: pullRequest.number,
  url: pullRequest.url,
});
