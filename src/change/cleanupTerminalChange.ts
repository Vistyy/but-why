import { Effect } from "effect";

import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import {
  type ChangeCleanup,
  type ChangeRecord,
  changeState,
  type RemoteChangeBranch,
} from "./change.js";
import type { ChangePersistence } from "./changePersistence.js";
import type {
  TranscriptIndexOperation,
  TranscriptIndexResult,
} from "./reviewerSession/reviewerTranscript.js";

export type ChangeCleanupOperationResult =
  | { readonly state: "complete" }
  | { readonly state: "pending"; readonly blockingReason: string };

export type ChangeCleanupOperation = (input: {
  readonly repositoryCommonDirectory: string;
  readonly worktreePath: string | null;
  readonly branchRef: string;
  readonly remoteChangeBranch?: RemoteChangeBranch;
}) => ChangeCleanupOperationResult;

export type TerminalCleanupResult =
  | { readonly ok: true; readonly change: ChangeRecord; readonly cleanup: ChangeCleanup }
  | { readonly ok: false; readonly code: "change_not_found" | "change_not_closed" };

export type TerminalCleanupOperation = (
  change: ChangeRecord,
  now: string,
) => Effect.Effect<TerminalCleanupResult, RepositoryStorageError>;

export type ArtifactLifecycleOwner = {
  readonly removeContent: (changeId: string) => Effect.Effect<void, RepositoryStorageError>;
};

export const openTerminalCleanup =
  (dependencies: {
    readonly persistence: Pick<ChangePersistence, "recordCleanup" | "removeReviewerSessions">;
    readonly cleanup: ChangeCleanupOperation;
    readonly indexTranscripts?: TranscriptIndexOperation;
    readonly reviewerSessionPathFor?: (changeId: string) => string;
    readonly artifactLifecycle?: ArtifactLifecycleOwner;
  }): TerminalCleanupOperation =>
  (change, now) =>
    cleanupTerminalChange(dependencies, change, now);

const cleanupTerminalChange = (
  dependencies: Parameters<typeof openTerminalCleanup>[0],
  change: ChangeRecord,
  now: string,
): Effect.Effect<TerminalCleanupResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    if (change.cleanup.state === "complete") {
      return { ok: true, change, cleanup: change.cleanup };
    }
    if (change.state !== changeState.closed) return { ok: false, code: "change_not_closed" };

    const indexResult = yield* indexTranscripts(dependencies, change);
    if (indexResult !== undefined && !indexResult.ok) {
      return yield* recordPendingCleanup(dependencies, change, now, "transcript_index_failed");
    }

    const remoteChangeBranch = remoteChangeBranchFor(change);
    const result = dependencies.cleanup({
      repositoryCommonDirectory: change.repositoryCommonDirectory,
      worktreePath: change.worktreePath,
      branchRef: change.branchRef,
      ...(remoteChangeBranch === undefined ? {} : { remoteChangeBranch }),
    });
    const cleanup: ChangeCleanup =
      result.state === "complete"
        ? { state: "complete", blockingReason: null }
        : { state: "pending", blockingReason: result.blockingReason };
    const recorded = yield* dependencies.persistence.recordCleanup({
      changeId: change.id,
      cleanup,
      now,
    });
    if (!recorded.ok) return { ok: false, code: recorded.code };
    if (recorded.change.cleanup.state === "complete") {
      yield* dependencies.persistence.removeReviewerSessions(change.id);
      if (dependencies.artifactLifecycle !== undefined) {
        yield* dependencies.artifactLifecycle.removeContent(change.id);
      }
    }
    return { ok: true, change: recorded.change, cleanup: recorded.change.cleanup };
  });

const indexTranscripts = (
  dependencies: Parameters<typeof openTerminalCleanup>[0],
  change: ChangeRecord,
): Effect.Effect<TranscriptIndexResult | undefined, RepositoryStorageError> => {
  if (
    dependencies.indexTranscripts === undefined ||
    dependencies.reviewerSessionPathFor === undefined
  ) {
    return Effect.succeed(undefined);
  }
  return dependencies.indexTranscripts({
    changeId: change.id,
    reviewerSessionPath: dependencies.reviewerSessionPathFor(change.id),
  });
};

const recordPendingCleanup = (
  dependencies: Parameters<typeof openTerminalCleanup>[0],
  change: ChangeRecord,
  now: string,
  blockingReason: string,
): Effect.Effect<TerminalCleanupResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const recorded = yield* dependencies.persistence.recordCleanup({
      changeId: change.id,
      cleanup: { state: "pending", blockingReason },
      now,
    });
    if (!recorded.ok) return { ok: false, code: recorded.code };
    return { ok: true, change: recorded.change, cleanup: recorded.change.cleanup };
  });

const remoteChangeBranchFor = (change: ChangeRecord): RemoteChangeBranch | undefined => {
  const publication = change.publication;
  return publication !== null && publication.pullRequest !== null
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
