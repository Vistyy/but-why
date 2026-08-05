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
  readonly discardWork?: boolean;
}) => ChangeCleanupOperationResult;

export type TerminalCleanupResult =
  | { readonly ok: true; readonly change: ChangeRecord; readonly cleanup: ChangeCleanup }
  | { readonly ok: false; readonly code: "change_not_found" | "change_not_closed" };

export type ArtifactContentRemovalResult = { readonly ok: true } | { readonly ok: false };

export type ArtifactLifecycleOwner = {
  readonly removeContent: (
    changeId: string,
  ) => Effect.Effect<ArtifactContentRemovalResult, RepositoryStorageError>;
};

export type TerminalCleanupOperation = (
  change: ChangeRecord,
  now: string,
  discardWork?: boolean,
) => Effect.Effect<TerminalCleanupResult, RepositoryStorageError>;

export const openTerminalCleanup =
  (dependencies: {
    readonly persistence: Pick<ChangePersistence, "recordCleanup" | "removeReviewerSessions">;
    readonly cleanup: ChangeCleanupOperation;
    readonly indexTranscripts?: TranscriptIndexOperation;
    readonly reviewerSessionPathFor?: (changeId: string) => string;
    readonly artifactLifecycle?: ArtifactLifecycleOwner;
  }): TerminalCleanupOperation =>
  (change, now, discardWork) =>
    cleanupTerminalChange(dependencies, change, now, discardWork);

const cleanupTerminalChange = (
  dependencies: Parameters<typeof openTerminalCleanup>[0],
  change: ChangeRecord,
  now: string,
  discardWork: boolean | undefined,
): Effect.Effect<TerminalCleanupResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    if (change.cleanup.state === "complete") {
      return { ok: true, change, cleanup: change.cleanup };
    }
    if (change.state !== changeState.closed) return { ok: false, code: "change_not_closed" };

    const indexResult = yield* indexTranscripts(dependencies, change);
    if (indexResult !== undefined && !indexResult.ok) {
      return yield* recordCleanup(dependencies, change, now, {
        state: "pending",
        blockingReason: "transcript_index_failed",
      });
    }

    const remoteChangeBranch = remoteChangeBranchFor(change);
    const result = dependencies.cleanup({
      repositoryCommonDirectory: change.repositoryCommonDirectory,
      worktreePath: change.worktreePath,
      branchRef: change.branchRef,
      ...(remoteChangeBranch === undefined ? {} : { remoteChangeBranch }),
      ...(discardWork === undefined ? {} : { discardWork }),
    });
    if (result.state === "pending") {
      return yield* recordCleanup(dependencies, change, now, {
        state: "pending",
        blockingReason: result.blockingReason,
      });
    }

    const artifactContentRemoved = yield* removeArtifactContent(dependencies, change);
    const cleanup: ChangeCleanup = artifactContentRemoved
      ? { state: "complete", blockingReason: null }
      : { state: "pending", blockingReason: "artifact_content_removal_failed" };
    const recorded = yield* recordCleanup(dependencies, change, now, cleanup);
    if (!recorded.ok) return recorded;
    if (recorded.change.cleanup.state === "complete") {
      yield* dependencies.persistence.removeReviewerSessions(change.id);
    }
    return { ok: true, change: recorded.change, cleanup: recorded.change.cleanup };
  });

const removeArtifactContent = (
  dependencies: Parameters<typeof openTerminalCleanup>[0],
  change: ChangeRecord,
): Effect.Effect<boolean, RepositoryStorageError> =>
  dependencies.artifactLifecycle === undefined
    ? Effect.succeed(true)
    : Effect.map(dependencies.artifactLifecycle.removeContent(change.id), (result) => result.ok);

const recordCleanup = (
  dependencies: Parameters<typeof openTerminalCleanup>[0],
  change: ChangeRecord,
  now: string,
  cleanup: ChangeCleanup,
): Effect.Effect<TerminalCleanupResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const recorded = yield* dependencies.persistence.recordCleanup({
      changeId: change.id,
      cleanup,
      now,
    });
    if (!recorded.ok) return { ok: false, code: recorded.code };
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
