import type { Effect } from "effect";
import type { ReviewerSessionRecord } from "../agent/reviewerSession/reviewerSession.js";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type { TaskRecord } from "../task/task.js";
import type { PublicTaskId } from "../task/taskId.js";
import type { CandidateValidationPolicySnapshot } from "./candidateValidation/candidateValidationPolicySnapshot.js";
import type {
  ChangeCleanup,
  ChangeCloseReason,
  ChangeOwnedPullRequest,
  ChangePublication,
  ChangeRecord,
  ChangeState,
  RemoteChangeBranch,
} from "./change.js";
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
import type { ReviewerTranscript } from "./reviewerSession/reviewerTranscript.js";
import type { AcceptanceContextSnapshotV1 } from "./validationRun/acceptanceContextSnapshot.js";

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

type ImplementationBlockerPersistenceResult =
  | { readonly ok: true; readonly blocker: ImplementationBlocker }
  | Extract<ImplementationBlockerMutationResult, { readonly ok: false }>;

export type CurrentChangeEvidenceQuery = {
  readonly candidateId?: string;
  readonly validationRunId?: string;
  readonly changeBaseSha?: string;
  readonly policy?: CandidateValidationPolicySnapshot;
};

export type ChangeAuthorityPort = {
  readonly raiseImplementationBlocker: (
    input: RaiseImplementationBlockerInput,
  ) => StorageEffect<ImplementationBlockerPersistenceResult>;
  readonly resolveImplementationBlocker: (
    input: ResolveImplementationBlockerInput,
  ) => StorageEffect<ImplementationBlockerPersistenceResult>;
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

export type ChangeTaskProjectionRecord = {
  readonly id: string;
  readonly state: ChangeState;
  readonly activeBlocker: ImplementationBlocker | null;
};

export type ChangeListRecord = {
  readonly id: string;
  readonly taskId: PublicTaskId | null;
  readonly state: ChangeState;
  readonly branchRef: string;
  readonly worktreePath: string | null;
  readonly createdAt: string;
};

export type ChangeReadPort = {
  readonly getChangeById: (changeId: string) => StorageEffect<ChangeRecord | undefined>;
  readonly getChangeByTaskId: (
    taskId: string,
  ) => StorageEffect<ChangeTaskProjectionRecord | undefined>;
  readonly listChanges: (input: ListChangesInput) => StorageEffect<readonly ChangeListRecord[]>;
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

export type TerminalCleanupChange = {
  readonly id: string;
  readonly state: ChangeState;
  readonly repositoryCommonDirectory: string;
  readonly branchRef: string;
  readonly worktreePath: string | null;
  readonly publication: ChangePublication | null;
  readonly cleanup: ChangeCleanup;
  readonly remoteChangeBranch: RemoteChangeBranch | null;
};

export type SubmissionChange = {
  readonly id: string;
  readonly state: ChangeState;
  readonly branchRef: string;
  readonly baseRef: string | null;
  readonly baseRemoteUrl: string | null;
  readonly worktreePath: string | null;
  readonly acceptanceContext: AcceptanceContextSnapshotV1 | null;
  readonly publication: ChangePublication | null;
};

export type ReconciliationChange = TerminalCleanupChange;

export type CancellationChange = TerminalCleanupChange & {
  readonly taskId: PublicTaskId | null;
  readonly closeReason: ChangeCloseReason | null;
  readonly cancelReason: string | null;
};

type CompleteMergedFailure = {
  readonly ok: false;
  readonly code: "change_not_found" | "change_already_closed" | "publication_mismatch";
};

export type ChangeSubmissionPort = {
  readonly getChangeById: (changeId: string) => StorageEffect<SubmissionChange | undefined>;
  readonly getChangeForOutputById: (changeId: string) => StorageEffect<ChangeRecord | undefined>;
  readonly getCompletedPublicationEvidence: (
    changeId: string,
    candidateId: string,
    validationRunId: string,
  ) => StorageEffect<ChangePublicationEvidence | undefined>;
  readonly completeMergedChange: (
    input: CompleteMergedChangeInput,
  ) => StorageEffect<
    | { readonly ok: true; readonly changed: boolean; readonly changeId: string }
    | CompleteMergedFailure
  >;
};

export type ChangeReconciliationPort = {
  readonly getChangeById: (changeId: string) => StorageEffect<ReconciliationChange | undefined>;
  readonly listChangesForReconciliation: (
    repositoryCommonDirectory: string,
  ) => StorageEffect<readonly ReconciliationChange[]>;
  readonly completeMergedChange: (
    input: CompleteMergedChangeInput,
  ) => StorageEffect<
    | { readonly ok: true; readonly changed: boolean; readonly change: ReconciliationChange }
    | CompleteMergedFailure
  >;
};

export type ChangeCancellationPort = {
  readonly getChangeById: (changeId: string) => StorageEffect<CancellationChange | undefined>;
  readonly getChangeByTaskId: (taskId: string) => StorageEffect<CancellationChange | undefined>;
  readonly completeMergedChange: (input: CompleteMergedChangeInput) => StorageEffect<
    | {
        readonly ok: true;
        readonly changed: boolean;
        readonly change: CancellationChange;
        readonly task: TaskRecord | null;
      }
    | CompleteMergedFailure
  >;
  readonly cancelChange: (input: CancelChangeInput) => StorageEffect<
    | {
        readonly ok: true;
        readonly changed: boolean;
        readonly change: CancellationChange;
        readonly task: TaskRecord | null;
      }
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
    | { readonly ok: true; readonly changed: boolean; readonly cleanup: ChangeCleanup }
    | { readonly ok: false; readonly code: "change_not_found" | "change_not_closed" }
  >;
  readonly removeReviewerSessions: (changeId: string) => StorageEffect<void>;
};

type CandidatePublicationChangeBase = {
  readonly id: string;
  readonly state: ChangeState;
  readonly branchRef: string;
  readonly startingCommit: string | null;
  readonly taskId: PublicTaskId | null;
  readonly acceptanceContext: AcceptanceContextSnapshotV1 | null;
  readonly implementationDecisions: readonly ImplementationDecision[];
};

export type CandidatePublicationChange = CandidatePublicationChangeBase & {
  readonly publication: ChangePublication | null;
};

export type PendingCandidatePublicationChange = CandidatePublicationChangeBase & {
  readonly publication: ChangePublication & { readonly pullRequest: null };
};

export type PublishedCandidatePublicationChange = CandidatePublicationChangeBase & {
  readonly publication: ChangePublication & { readonly pullRequest: ChangeOwnedPullRequest };
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
    | {
        readonly ok: true;
        readonly created: boolean;
        readonly change: PendingCandidatePublicationChange;
      }
    | {
        readonly ok: false;
        readonly code: "change_not_found" | "change_closed" | "publication_already_owned";
      }
  >;
  readonly replacePendingPublication: (
    input: ReplacePendingChangePublicationInput,
  ) => StorageEffect<
    | { readonly ok: true; readonly change: PendingCandidatePublicationChange }
    | {
        readonly ok: false;
        readonly code: "change_not_found" | "change_closed" | "publication_state_conflict";
      }
  >;
  readonly releasePendingPublication: (input: BeginChangePublicationInput) => StorageEffect<
    | { readonly ok: true; readonly publication: null }
    | {
        readonly ok: false;
        readonly code: "change_not_found" | "change_closed" | "publication_state_conflict";
      }
  >;
  readonly recordPublishedPullRequest: (input: RecordPublishedPullRequestInput) => StorageEffect<
    | { readonly ok: true; readonly change: PublishedCandidatePublicationChange }
    | {
        readonly ok: false;
        readonly code: "change_not_found" | "change_closed" | "publication_state_conflict";
      }
  >;
};
