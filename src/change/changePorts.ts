import type { Effect } from "effect";

import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type { CandidateValidationPolicySnapshot } from "./candidateValidation/candidateValidationPolicySnapshot.js";
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
      readonly code: "change_not_found" | "change_not_open" | "submission_in_progress";
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
        | "no_active_blocker"
        | "submission_in_progress";
    };

export type CurrentChangeEvidenceQuery = {
  readonly candidateId?: string;
  readonly validationRunId?: string;
  readonly changeBaseSha?: string;
  readonly policy?: CandidateValidationPolicySnapshot;
};

export type ChangeAuthorityPort = {
  readonly raiseImplementationBlocker: (
    input: RaiseImplementationBlockerInput,
  ) => StorageEffect<ImplementationBlockerMutationResult>;
  readonly resolveImplementationBlocker: (
    input: ResolveImplementationBlockerInput,
  ) => StorageEffect<ImplementationBlockerMutationResult>;
  readonly listImplementationBlockers: (
    changeId: string,
  ) => StorageEffect<ImplementationBlockerHistory | undefined>;
  readonly listImplementationDecisions: (
    changeId: string,
  ) => StorageEffect<readonly ImplementationDecision[]>;
  readonly recordImplementationDecision: (
    input: RecordImplementationDecisionInput,
  ) => StorageEffect<RecordImplementationDecisionResult>;
  readonly getCurrentPassingEvidence: (
    changeId: string,
    query?: CurrentChangeEvidenceQuery,
  ) => StorageEffect<ChangePublicationEvidence | undefined>;
};

export type ChangeReadPort = {
  readonly getChangeById: (changeId: string) => StorageEffect<ChangeRecord | undefined>;
  readonly getChangeByTaskId: (taskId: string) => StorageEffect<ChangeRecord | undefined>;
  readonly listChanges: (input: ListChangesInput) => StorageEffect<readonly ChangeRecord[]>;
};

export type ChangeDeliveryPort = {
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
};

export type ChangeReviewerSessionPort = {
  readonly getReviewerSession: (
    changeId: string,
    producer: string,
  ) => StorageEffect<ReviewerSessionRecord | undefined>;
  readonly saveReviewerSession: (input: ReviewerSessionRecord) => StorageEffect<void>;
  readonly removeReviewerSession: (changeId: string, producer: string) => StorageEffect<void>;
  readonly removeReviewerSessions: (changeId: string) => StorageEffect<void>;
};

export type ChangeReviewerTranscriptPort = {
  readonly listReviewerTranscripts: (
    changeId: string,
  ) => StorageEffect<readonly ReviewerTranscript[]>;
  readonly recordReviewerTranscripts: (input: {
    readonly changeId: string;
    readonly transcripts: readonly ReviewerTranscript[];
  }) => StorageEffect<void>;
};

export type CompletedPublicationEvidencePort = {
  readonly getCompletedPublicationEvidence: (
    changeId: string,
    candidateId: string,
    validationRunId: string,
  ) => StorageEffect<ChangePublicationEvidence | undefined>;
};

export type ChangeSubmissionPort = {
  readonly getChangeById: ChangeReadPort["getChangeById"];
  readonly getCompletedPublicationEvidence: CompletedPublicationEvidencePort["getCompletedPublicationEvidence"];
  readonly completeMergedChange: ChangeDeliveryPort["completeMergedChange"];
};

export type ChangeReconciliationPort = {
  readonly getChangeById: ChangeReadPort["getChangeById"];
  readonly listChangesForReconciliation: ChangeDeliveryPort["listChangesForReconciliation"];
  readonly completeMergedChange: ChangeDeliveryPort["completeMergedChange"];
};

export type ChangeCancellationPort = {
  readonly getChangeById: ChangeReadPort["getChangeById"];
  readonly getChangeByTaskId: ChangeReadPort["getChangeByTaskId"];
  readonly completeMergedChange: ChangeDeliveryPort["completeMergedChange"];
  readonly cancelChange: ChangeDeliveryPort["cancelChange"];
};

export type TerminalChangeCleanupPort = {
  readonly recordCleanup: ChangeDeliveryPort["recordCleanup"];
  readonly removeReviewerSessions: ChangeReviewerSessionPort["removeReviewerSessions"];
};

export type CandidatePublicationPort = {
  readonly getChangeById: ChangeReadPort["getChangeById"];
  readonly getCurrentPassingEvidence: ChangeAuthorityPort["getCurrentPassingEvidence"];
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
