import type {
  ChangeCleanup,
  ChangeCloseReason,
  ChangeOwnedPullRequest,
  ChangePublicationTarget,
  ChangeRecord,
} from "./change.js";

export type ChangeStore = {
  readonly createChange: (input: CreateChangeInput) => CreateChangeResult;
  readonly getChangeById: (changeId: string) => ChangeRecord | undefined;
  readonly getChangeByTaskId: (taskId: string) => ChangeRecord | undefined;
  readonly getChangeByRepositoryBranch: (
    repositoryCommonDirectory: string,
    branchRef: string,
  ) => ChangeRecord | undefined;
  readonly listChanges: (input: ListChangesInput) => readonly ChangeRecord[];
  readonly listChangesForReconciliation: (
    repositoryCommonDirectory: string,
  ) => readonly ChangeRecord[];
  readonly closeChange: (input: CloseChangeInput) => CloseChangeResult;
  readonly completeMergedChange: (input: CompleteMergedChangeInput) => CompleteMergedChangeResult;
  readonly recordCleanup: (input: RecordChangeCleanupInput) => RecordChangeCleanupResult;
  readonly beginPublication: (input: BeginChangePublicationInput) => BeginChangePublicationResult;
  readonly releasePendingPublication: (
    input: BeginChangePublicationInput,
  ) => ReleasePendingPublicationResult;
  readonly recordPublishedPullRequest: (
    input: RecordPublishedPullRequestInput,
  ) => RecordPublishedPullRequestResult;
};

export type CreateChangeInput = {
  readonly repositoryCommonDirectory: string;
  readonly branchRef: string;
  readonly now: string;
};

export type ListChangesInput = {
  readonly repositoryCommonDirectory: string;
  readonly includeClosed: boolean;
};

export type CloseChangeInput = {
  readonly changeId: string;
  readonly reason: ChangeCloseReason;
  readonly now: string;
};

export type CompleteMergedChangeInput = {
  readonly changeId: string;
  readonly now: string;
};

export type RecordChangeCleanupInput = {
  readonly changeId: string;
  readonly cleanup: ChangeCleanup;
  readonly now: string;
};

export type BeginChangePublicationInput = {
  readonly changeId: string;
  readonly candidateId: string;
  readonly validationRunId: string;
  readonly target: ChangePublicationTarget;
  readonly headBranch: string;
  readonly expectedHeadSha: string;
  readonly now: string;
};

export type RecordPublishedPullRequestInput = BeginChangePublicationInput & {
  readonly pullRequest: ChangeOwnedPullRequest;
  readonly previousExpectedHeadSha?: string;
  readonly previousCandidateId?: string;
  readonly previousValidationRunId?: string;
};

export type CloseChangeResult =
  | { readonly ok: true; readonly changed: boolean; readonly change: ChangeRecord }
  | { readonly ok: false; readonly code: "change_not_found" }
  | {
      readonly ok: false;
      readonly code: "change_already_closed";
      readonly reason: ChangeCloseReason;
    };

export type CreateChangeResult =
  | { readonly ok: true; readonly change: ChangeRecord }
  | {
      readonly ok: false;
      readonly code: "repository_branch_already_linked";
    };

export type CompleteMergedChangeResult =
  | { readonly ok: true; readonly changed: boolean; readonly change: ChangeRecord }
  | { readonly ok: false; readonly code: "change_not_found" | "change_already_closed" };

export type RecordChangeCleanupResult =
  | { readonly ok: true; readonly changed: boolean; readonly change: ChangeRecord }
  | { readonly ok: false; readonly code: "change_not_found" | "change_not_closed" };

export type BeginChangePublicationResult =
  | { readonly ok: true; readonly created: boolean; readonly change: ChangeRecord }
  | {
      readonly ok: false;
      readonly code: "change_not_found" | "change_closed" | "publication_already_owned";
    };

export type ReleasePendingPublicationResult =
  | { readonly ok: true; readonly change: ChangeRecord }
  | {
      readonly ok: false;
      readonly code: "change_not_found" | "change_closed" | "publication_state_conflict";
    };

export type RecordPublishedPullRequestResult =
  | { readonly ok: true; readonly change: ChangeRecord }
  | {
      readonly ok: false;
      readonly code: "change_not_found" | "change_closed" | "publication_state_conflict";
    };
