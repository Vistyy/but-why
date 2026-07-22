import type { Effect } from "effect";

import type { RepositoryStorageError } from "../repositoryStorageError.js";
import type { ChangeRecord } from "./change.js";
import type {
  BeginChangePublicationInput,
  BeginChangePublicationResult,
  CompleteMergedChangeInput,
  CompleteMergedChangeResult,
  ListChangesInput,
  RecordChangeCleanupInput,
  RecordChangeCleanupResult,
  RecordPublishedPullRequestInput,
  RecordPublishedPullRequestResult,
  ReleasePendingPublicationResult,
} from "./changeStore.js";

type StorageEffect<A> = Effect.Effect<A, RepositoryStorageError>;

export type ChangePersistence = {
  readonly getChangeById: (changeId: string) => StorageEffect<ChangeRecord | undefined>;
  readonly getChangeByTaskId: (taskId: string) => StorageEffect<ChangeRecord | undefined>;
  readonly listChanges: (input: ListChangesInput) => StorageEffect<readonly ChangeRecord[]>;
  readonly listChangesForReconciliation: (
    repositoryCommonDirectory: string,
  ) => StorageEffect<readonly ChangeRecord[]>;
  readonly completeMergedChange: (
    input: CompleteMergedChangeInput,
  ) => StorageEffect<CompleteMergedChangeResult>;
  readonly recordCleanup: (
    input: RecordChangeCleanupInput,
  ) => StorageEffect<RecordChangeCleanupResult>;
  readonly beginPublication: (
    input: BeginChangePublicationInput,
  ) => StorageEffect<BeginChangePublicationResult>;
  readonly releasePendingPublication: (
    input: BeginChangePublicationInput,
  ) => StorageEffect<ReleasePendingPublicationResult>;
  readonly recordPublishedPullRequest: (
    input: RecordPublishedPullRequestInput,
  ) => StorageEffect<RecordPublishedPullRequestResult>;
};
