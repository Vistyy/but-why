import type { Effect } from "effect";

import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type { CandidateValidationPolicySnapshot } from "./candidateValidation/candidateValidationPolicySnapshot.js";
import type { ChangePublication, ChangeRecord, ChangeState } from "./change.js";
import type {
  BeginChangePublicationInput,
  CancelChangeInput,
  CompleteMergedChangeInput,
  ListChangesInput,
  RecordChangeCleanupInput,
  RecordPublishedPullRequestInput,
  ReplacePendingChangePublicationInput,
} from "./changeStore.js";
import type {
  ImplementationBlocker,
  ImplementationBlockerHistory,
} from "./implementationBlocker.js";
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
      readonly blocker: ImplementationBlocker;
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

export type ChangeSubmissionPort = {
  readonly getChangeById: (changeId: string) => StorageEffect<ChangeRecord | undefined>;
  readonly getCompletedPublicationEvidence: (
    changeId: string,
    candidateId: string,
    validationRunId: string,
  ) => StorageEffect<ChangePublicationEvidence | undefined>;
  readonly completeMergedChange: (input: CompleteMergedChangeInput) => StorageEffect<
    | { readonly ok: true; readonly changed: boolean; readonly change: ChangeRecord }
    | {
        readonly ok: false;
        readonly code: "change_not_found" | "change_already_closed" | "publication_mismatch";
      }
  >;
};

export type ChangeReconciliationPort = {
  readonly getChangeById: (changeId: string) => StorageEffect<ChangeRecord | undefined>;
  readonly listChangesForReconciliation: (
    repositoryCommonDirectory: string,
  ) => StorageEffect<readonly ChangeRecord[]>;
  readonly completeMergedChange: (input: CompleteMergedChangeInput) => StorageEffect<
    | { readonly ok: true; readonly changed: boolean; readonly change: ChangeRecord }
    | {
        readonly ok: false;
        readonly code: "change_not_found" | "change_already_closed" | "publication_mismatch";
      }
  >;
};

export type ChangeCancellationPort = {
  readonly getChangeById: (changeId: string) => StorageEffect<ChangeRecord | undefined>;
  readonly getChangeByTaskId: (taskId: string) => StorageEffect<ChangeRecord | undefined>;
  readonly completeMergedChange: (input: CompleteMergedChangeInput) => StorageEffect<
    | { readonly ok: true; readonly changed: boolean; readonly change: ChangeRecord }
    | {
        readonly ok: false;
        readonly code: "change_not_found" | "change_already_closed" | "publication_mismatch";
      }
  >;
  readonly cancelChange: (input: CancelChangeInput) => StorageEffect<
    | { readonly ok: true; readonly changed: boolean; readonly change: ChangeRecord }
    | {
        readonly ok: false;
        readonly code: "change_not_found" | "change_already_completed";
      }
  >;
};

export type TerminalChangeCleanupPort = {
  readonly recordCleanup: (
    input: RecordChangeCleanupInput,
  ) => StorageEffect<
    | { readonly ok: true; readonly changed: boolean; readonly cleanup: ChangeRecord["cleanup"] }
    | { readonly ok: false; readonly code: "change_not_found" | "change_not_closed" }
  >;
  readonly removeReviewerSessions: (changeId: string) => StorageEffect<void>;
};

export type CandidatePublicationChange = {
  readonly id: string;
  readonly state: ChangeState;
  readonly branchRef: string;
  readonly startingCommit: string | null;
  readonly taskId: ChangeRecord["taskId"];
  readonly acceptanceContext: ChangeRecord["acceptanceContext"];
  readonly implementationDecisions: readonly ImplementationDecision[];
  readonly publication: ChangePublication | null;
};

export type CandidatePublicationPort = {
  readonly getChangeById: (
    changeId: string,
  ) => StorageEffect<CandidatePublicationChange | undefined>;
  readonly getCurrentPassingEvidence: (
    changeId: string,
    query?: CurrentChangeEvidenceQuery,
  ) => StorageEffect<ChangePublicationEvidence | undefined>;
  readonly beginPublication: (input: BeginChangePublicationInput) => StorageEffect<
    | { readonly ok: true; readonly created: boolean; readonly change: CandidatePublicationChange }
    | {
        readonly ok: false;
        readonly code: "change_not_found" | "change_closed" | "publication_already_owned";
      }
  >;
  readonly replacePendingPublication: (
    input: ReplacePendingChangePublicationInput,
  ) => StorageEffect<
    | { readonly ok: true; readonly change: CandidatePublicationChange }
    | {
        readonly ok: false;
        readonly code: "change_not_found" | "change_closed" | "publication_state_conflict";
      }
  >;
  readonly releasePendingPublication: (input: BeginChangePublicationInput) => StorageEffect<
    | { readonly ok: true; readonly change: CandidatePublicationChange }
    | {
        readonly ok: false;
        readonly code: "change_not_found" | "change_closed" | "publication_state_conflict";
      }
  >;
  readonly recordPublishedPullRequest: (input: RecordPublishedPullRequestInput) => StorageEffect<
    | { readonly ok: true; readonly change: CandidatePublicationChange }
    | {
        readonly ok: false;
        readonly code: "change_not_found" | "change_closed" | "publication_state_conflict";
      }
  >;
};
