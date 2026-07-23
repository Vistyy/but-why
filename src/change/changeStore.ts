import type {
  ChangeCleanup,
  ChangeOwnedPullRequest,
  ChangePublicationTarget,
  ChangeRecord,
} from "./change.js";

export type ListChangesInput = {
  readonly repositoryCommonDirectory: string;
  readonly includeClosed: boolean;
};

export type CompleteMergedChangeInput = {
  readonly changeId: string;
  readonly now: string;
};

export type CompleteNoChangeInput = {
  readonly changeId: string;
  readonly taskId: string;
  readonly now: string;
};

export type CancelChangeInput = {
  readonly changeId: string;
  readonly reason: string;
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

export type CompleteMergedChangeResult =
  | { readonly ok: true; readonly changed: boolean; readonly change: ChangeRecord }
  | { readonly ok: false; readonly code: "change_not_found" | "change_already_closed" };

export type CompleteNoChangeResult =
  | { readonly ok: true; readonly changed: boolean }
  | {
      readonly ok: false;
      readonly code:
        | "change_not_found"
        | "change_not_open"
        | "task_not_found"
        | "task_already_completed";
    };

export type CancelChangeResult =
  | { readonly ok: true; readonly changed: boolean; readonly change: ChangeRecord }
  | {
      readonly ok: false;
      readonly code: "change_not_found" | "change_already_completed";
    };

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
