import type { Effect } from "effect";
import type {
  AgentSessionConfiguration,
  AgentSessionSqlLink,
} from "../../agent/agentSession/agentSession.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { DisposableWorkspaceCleanupState } from "../../disposableWorkspace/disposableWorkspace.js";
import type { TaskState } from "../lifecycle.js";
import type { PublicTaskId } from "../taskId.js";
import type {
  TaskReviewDependencyEvidence,
  TaskReviewFinding,
  TaskReviewPolicySnapshot,
  TaskReviewProposal,
  TaskReviewRecord,
  TaskReviewToolingFailure,
} from "./taskReview.js";

export type AdmitTaskReviewInput = {
  readonly taskId: PublicTaskId;
  readonly policy: TaskReviewPolicySnapshot;
  readonly baseRef: string;
  readonly baseCommit: string;
  readonly now: string;
};

export type TaskReviewAdmissionRejection =
  | { readonly ok: false; readonly code: "task_not_found" }
  | { readonly ok: false; readonly code: "invalid_task_state"; readonly state: string }
  | {
      readonly ok: false;
      readonly code: "task_change_linked";
      readonly changeId: string;
    }
  | { readonly ok: false; readonly code: "active_task_review"; readonly reviewId: number };

export type AdmitTaskReviewResult =
  | {
      readonly ok: true;
      readonly review: TaskReviewRecord;
      readonly proposal: TaskReviewProposal;
      readonly dependencyEvidence: readonly TaskReviewDependencyEvidence[];
    }
  | TaskReviewAdmissionRejection;

export type CompleteTaskReviewInput = {
  readonly reviewId: number;
  readonly findings: readonly TaskReviewFinding[];
  readonly toolingFailure?: TaskReviewToolingFailure;
  readonly now: string;
  readonly agentSettlement?: boolean;
};

type CompletedTaskReviewRecord = Omit<TaskReviewRecord, "state" | "outcome"> & {
  readonly state: "complete";
};

type PassedTaskReviewRecord = CompletedTaskReviewRecord & {
  readonly outcome: "passed";
  readonly findings: readonly [];
  readonly toolingFailure: null;
};

type BlockedTaskReviewRecord = CompletedTaskReviewRecord & {
  readonly outcome: "blocked";
  readonly findings: readonly [TaskReviewFinding, ...TaskReviewFinding[]];
  readonly toolingFailure: null;
};

type ToolingFailedTaskReviewRecord = CompletedTaskReviewRecord & {
  readonly outcome: "tooling_failed";
  readonly toolingFailure: TaskReviewToolingFailure;
};

export type CompleteTaskReviewSuccess =
  | {
      readonly ok: true;
      readonly outcome: "passed";
      readonly review: PassedTaskReviewRecord;
      readonly task: { readonly id: string; readonly state: "todo" };
    }
  | {
      readonly ok: true;
      readonly outcome: "blocked";
      readonly review: BlockedTaskReviewRecord;
      readonly task: { readonly id: string; readonly state: "new" };
    }
  | {
      readonly ok: true;
      readonly outcome: "tooling_failed";
      readonly review: ToolingFailedTaskReviewRecord;
      readonly task: { readonly id: string; readonly state: TaskState };
    };

export type CompleteTaskReviewResult =
  | CompleteTaskReviewSuccess
  | { readonly ok: false; readonly code: "task_review_not_found" | "task_review_not_active" };

export type TaskReviewPersistence = {
  readonly reuseJudgment: (
    taskId: PublicTaskId,
    now: string,
  ) => Effect.Effect<CompleteTaskReviewSuccess | undefined, RepositoryStorageError>;
  readonly checkAdmission: (
    taskId: PublicTaskId,
  ) => Effect.Effect<TaskReviewAdmissionRejection | undefined, RepositoryStorageError>;
  readonly admit: (
    input: AdmitTaskReviewInput,
  ) => Effect.Effect<AdmitTaskReviewResult, RepositoryStorageError>;
  readonly recordCleanup: (
    reviewId: number,
    cleanup: DisposableWorkspaceCleanupState,
    now: string,
  ) => Effect.Effect<void, RepositoryStorageError>;
  readonly complete: (
    input: CompleteTaskReviewInput,
  ) => Effect.Effect<CompleteTaskReviewResult, RepositoryStorageError>;
  readonly abandon: (
    reviewId: number,
    reason: string,
    now: string,
  ) => Effect.Effect<CompleteTaskReviewResult, RepositoryStorageError>;
  readonly getById: (
    reviewId: number,
  ) => Effect.Effect<TaskReviewRecord | undefined, RepositoryStorageError>;
  readonly getLatestForTask: (
    taskId: PublicTaskId,
  ) => Effect.Effect<TaskReviewRecord | undefined, RepositoryStorageError>;
  readonly listForTask: (
    taskId: PublicTaskId,
  ) => Effect.Effect<readonly TaskReviewRecord[], RepositoryStorageError>;
  readonly getReviewerAgentSession: (
    taskId: string,
  ) => Effect.Effect<number | undefined, RepositoryStorageError>;
  readonly getReviewerConfiguration: (
    taskId: string,
  ) => Effect.Effect<TaskReviewPolicySnapshot | undefined, RepositoryStorageError>;
  readonly reviewerConfigurationCanBeCorrected: (
    taskId: string,
  ) => Effect.Effect<boolean, RepositoryStorageError>;
  readonly linkAgentInvocation: (input: {
    readonly taskId: string;
    readonly reviewId: number;
    readonly configuration: AgentSessionConfiguration;
    readonly configurationSnapshot?: unknown;
  }) => AgentSessionSqlLink;
  readonly settleAgentReview: (input: {
    readonly reviewId: number;
    readonly findings: readonly TaskReviewFinding[];
    readonly toolingFailure?: TaskReviewToolingFailure;
    readonly now: string;
    readonly complete: boolean;
  }) => AgentSessionSqlLink;
  readonly recordActiveFailure: (
    reviewId: number,
    failure: TaskReviewToolingFailure,
    now: string,
  ) => Effect.Effect<void, RepositoryStorageError>;
  readonly proposalIsCurrent: (
    review: TaskReviewRecord,
  ) => Effect.Effect<boolean, RepositoryStorageError>;
};

export type TaskReviewAdmissionPersistence = Pick<
  TaskReviewPersistence,
  "checkAdmission" | "admit"
>;
