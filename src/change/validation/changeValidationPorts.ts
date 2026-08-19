import type { Effect } from "effect";
import type { AgentSessionSqlLink } from "../../agent/agentSession/agentSession.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { CandidateRecord } from "../candidate/candidate.js";
import type {
  AbandonCandidateValidationRunInput,
  ActiveCandidateValidationRun,
  CandidateValidationAgentInvocation,
  CandidateValidationArtifact,
  CandidateValidationFinding,
  CandidateValidationPhaseResult,
  CandidateValidationRunAbandonmentContext,
  CandidateValidationRunRecord,
  CandidateValidationToolingFailure,
  CompleteCandidateValidationRunInput,
  RecordCandidateAcceptanceResultInput,
  RecordCandidateSpecialistResultInput,
  RecordCandidateToolingFailureInput,
  RecordCandidateValidationCheckResultInput,
  RecordCandidateValidationPrepareResultInput,
  RecordCandidateWorkspaceCleanupInput,
  StartCandidateValidationRunInput,
  StartCandidateValidationRunResult,
} from "../candidateValidation/candidateValidationRunStore.js";
import type {
  ValidationPhase,
  ValidationRunArtifactRecord,
  ValidationRunFindingRecord,
} from "../validationRun/validationRun.js";
import type { ValidationToolingFailureRecordInput } from "./validationToolingFailures.js";

type StorageEffect<A> = Effect.Effect<A, RepositoryStorageError>;

export type CandidateValidationExecutionPort = {
  readonly startOrReuse: (
    input: StartCandidateValidationRunInput,
  ) => StorageEffect<StartCandidateValidationRunResult>;
  readonly complete: (input: CompleteCandidateValidationRunInput) => StorageEffect<void>;
  readonly recordWorkspaceCleanup: (
    input: RecordCandidateWorkspaceCleanupInput,
  ) => StorageEffect<void>;
  readonly recordToolingFailure: (input: RecordCandidateToolingFailureInput) => StorageEffect<void>;
  readonly recordPrepareResult: (
    input: RecordCandidateValidationPrepareResultInput,
  ) => StorageEffect<void>;
  readonly recordCheckResult: (
    input: RecordCandidateValidationCheckResultInput,
  ) => StorageEffect<void>;
  readonly recordAcceptanceResult: (
    input: RecordCandidateAcceptanceResultInput,
  ) => StorageEffect<void>;
  readonly recordSpecialistResult: (
    input: RecordCandidateSpecialistResultInput,
  ) => StorageEffect<void>;
  readonly settleAgentInvocationResult: (input: {
    readonly validationRunId: number;
    readonly phase: ValidationPhase;
    readonly producer: string;
    readonly outcome: "passed" | "failed";
    readonly findings: readonly ValidationRunFindingRecord[];
    readonly artifactRecords: readonly ValidationRunArtifactRecord[];
    readonly toolingFailure?: ValidationToolingFailureRecordInput & {
      readonly validationRunId: number;
    };
  }) => AgentSessionSqlLink;
  readonly listPhaseResults: (
    validationRunId: number,
  ) => StorageEffect<readonly CandidateValidationPhaseResult[]>;
  readonly listFindings: (
    validationRunId: number,
  ) => StorageEffect<readonly CandidateValidationFinding[]>;
  readonly listPreviousCandidateReviewerFindings: (input: {
    readonly candidateId: number;
    readonly phase: ValidationPhase;
    readonly producer: string;
  }) => StorageEffect<readonly CandidateValidationFinding[]>;
  readonly listToolingFailures: (
    validationRunId: number,
  ) => StorageEffect<readonly CandidateValidationToolingFailure[]>;
  readonly listArtifacts: (
    validationRunId: number,
  ) => StorageEffect<readonly CandidateValidationArtifact[]>;
};

export type ChangeValidationReadPort = {
  readonly getCandidateById: (candidateId: number) => StorageEffect<CandidateRecord | undefined>;
  readonly getCurrentCandidateForChange: (
    changeId: string,
  ) => StorageEffect<CandidateRecord | undefined>;
  readonly listCandidatesForChange: (changeId: string) => StorageEffect<readonly CandidateRecord[]>;
  readonly getRunById: (
    validationRunId: number,
  ) => StorageEffect<CandidateValidationRunRecord | undefined>;
  readonly listRunsForCandidate: (
    candidateId: number,
  ) => StorageEffect<readonly CandidateValidationRunRecord[]>;
  readonly listPhaseResults: CandidateValidationExecutionPort["listPhaseResults"];
  readonly listFindings: CandidateValidationExecutionPort["listFindings"];
  readonly listToolingFailures: CandidateValidationExecutionPort["listToolingFailures"];
  readonly listArtifacts: CandidateValidationExecutionPort["listArtifacts"];
  readonly listAgentInvocations: (
    validationRunId: number,
  ) => StorageEffect<readonly CandidateValidationAgentInvocation[]>;
};

export type ActiveValidationRunPort = {
  readonly getActiveForChange: (
    changeId: string,
  ) => StorageEffect<ActiveCandidateValidationRun | undefined>;
};

export type ValidationRunAbandonmentPort = {
  readonly getAbandonmentContext: (
    validationRunId: number,
  ) => StorageEffect<CandidateValidationRunAbandonmentContext | undefined>;
  readonly getRunById: ChangeValidationReadPort["getRunById"];
  readonly recordToolingFailure: CandidateValidationExecutionPort["recordToolingFailure"];
  readonly recordWorkspaceCleanup: CandidateValidationExecutionPort["recordWorkspaceCleanup"];
  readonly abandon: (input: AbandonCandidateValidationRunInput) => StorageEffect<void>;
};

export type ValidationArtifactLifecyclePort = {
  readonly listRunIdsForChange: (changeId: string) => StorageEffect<readonly number[]>;
};
