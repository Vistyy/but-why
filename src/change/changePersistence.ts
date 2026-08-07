import type { Effect } from "effect";

import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type { CandidateValidationPolicySnapshot } from "./candidateValidation/candidateValidationRunStore.js";
import type { ChangeRecord } from "./change.js";
import type {
  BeginChangePublicationInput,
  BeginChangePublicationResult,
  CancelChangeInput,
  CancelChangeResult,
  CompleteMergedChangeInput,
  CompleteMergedChangeResult,
  ListChangesInput,
  RecordChangeCleanupInput,
  RecordChangeCleanupResult,
  RecordPublishedPullRequestInput,
  RecordPublishedPullRequestResult,
  ReleasePendingPublicationResult,
  ReplacePendingChangePublicationInput,
  ReplacePendingChangePublicationResult,
} from "./changeStore.js";
import type { ImplementationBlockerHistory } from "./implementationBlocker.js";
import type { ImplementationDecision } from "./implementationDecision.js";
import type { ReviewerSessionRecord } from "./reviewerSession/reviewerSession.js";
import type { ReviewerTranscript } from "./reviewerSession/reviewerTranscript.js";

type StorageEffect<A> = Effect.Effect<A, RepositoryStorageError>;

export type ChangePublicationEvidence = {
  readonly candidateId: string;
  readonly validationRunId: string;
  readonly changeBaseSha: string;
  readonly headSha: string;
};

export type RecordImplementationDecisionInput = {
  readonly changeId: string;
  readonly choice: string;
  readonly rationale: string;
  readonly now: string;
};

export type RecordImplementationDecisionResult =
  | { readonly ok: true; readonly decision: ImplementationDecision }
  | {
      readonly ok: false;
      readonly code: "change_not_found" | "change_not_open";
    };

export type RaiseImplementationBlockerInput = {
  readonly changeId: string;
  readonly content: string;
  readonly now: string;
};
export type ResolveImplementationBlockerInput = {
  readonly changeId: string;
  readonly content: string;
  readonly now: string;
};
export type ImplementationBlockerMutationResult =
  | {
      readonly ok: true;
      readonly change: ChangeRecord;
      readonly blocker: import("./implementationBlocker.js").ImplementationBlocker;
    }
  | {
      readonly ok: false;
      readonly code:
        | "change_not_found"
        | "change_not_open"
        | "change_blocked"
        | "no_active_blocker";
    };

export type CurrentPublicationAuthority = {
  readonly changeBaseSha: string;
  readonly policy: CandidateValidationPolicySnapshot;
  readonly implementationDecisions: readonly ImplementationDecision[];
};

export type ChangePersistence = {
  readonly raiseImplementationBlocker: (
    input: RaiseImplementationBlockerInput,
  ) => StorageEffect<ImplementationBlockerMutationResult>;
  readonly resolveImplementationBlocker: (
    input: ResolveImplementationBlockerInput,
  ) => StorageEffect<ImplementationBlockerMutationResult>;
  readonly listImplementationBlockers: (
    changeId: string,
  ) => StorageEffect<ImplementationBlockerHistory | undefined>;
  readonly getChangeById: (changeId: string) => StorageEffect<ChangeRecord | undefined>;
  readonly getChangeByTaskId: (taskId: string) => StorageEffect<ChangeRecord | undefined>;
  readonly listImplementationDecisions: (
    changeId: string,
  ) => StorageEffect<readonly ImplementationDecision[]>;
  readonly recordImplementationDecision: (
    input: RecordImplementationDecisionInput,
  ) => StorageEffect<RecordImplementationDecisionResult>;
  readonly getPassingPublicationEvidence: (
    changeId: string,
    authority: CurrentPublicationAuthority,
  ) => StorageEffect<ChangePublicationEvidence | undefined>;
  readonly listChanges: (input: ListChangesInput) => StorageEffect<readonly ChangeRecord[]>;
  readonly listChangesForReconciliation: (
    repositoryCommonDirectory: string,
  ) => StorageEffect<readonly ChangeRecord[]>;
  readonly completeMergedChange: (
    input: CompleteMergedChangeInput,
  ) => StorageEffect<CompleteMergedChangeResult>;
  readonly cancelChange: (input: CancelChangeInput) => StorageEffect<CancelChangeResult>;
  readonly recordCleanup: (
    input: RecordChangeCleanupInput,
  ) => StorageEffect<RecordChangeCleanupResult>;
  readonly getReviewerSession: (
    changeId: string,
    producer: string,
  ) => StorageEffect<ReviewerSessionRecord | undefined>;
  readonly saveReviewerSession: (input: ReviewerSessionRecord) => StorageEffect<void>;
  readonly removeReviewerSession: (changeId: string, producer: string) => StorageEffect<void>;
  readonly removeReviewerSessions: (changeId: string) => StorageEffect<void>;
  readonly listReviewerTranscripts: (
    changeId: string,
  ) => StorageEffect<readonly ReviewerTranscript[]>;
  readonly recordReviewerTranscripts: (input: {
    readonly changeId: string;
    readonly transcripts: readonly ReviewerTranscript[];
  }) => StorageEffect<void>;
  readonly beginPublication: (
    input: BeginChangePublicationInput,
  ) => StorageEffect<BeginChangePublicationResult>;
  readonly replacePendingPublication: (
    input: ReplacePendingChangePublicationInput,
  ) => StorageEffect<ReplacePendingChangePublicationResult>;
  readonly releasePendingPublication: (
    input: BeginChangePublicationInput,
  ) => StorageEffect<ReleasePendingPublicationResult>;
  readonly recordPublishedPullRequest: (
    input: RecordPublishedPullRequestInput,
  ) => StorageEffect<RecordPublishedPullRequestResult>;
};
