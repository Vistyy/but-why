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
  CandidateValidationRound,
  CandidateValidationRunAbandonmentContext,
  CandidateValidationRunRecord,
  CandidateValidationToolingFailure,
  CompleteCandidateValidationRunInput,
  RecordCandidateAcceptanceRoundInput,
  RecordCandidateSpecialistRoundInput,
  RecordCandidateToolingFailureInput,
  RecordCandidateValidationCheckRoundInput,
  RecordCandidateValidationPrepareRoundInput,
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
  readonly recordPrepareRound: (
    input: RecordCandidateValidationPrepareRoundInput,
  ) => StorageEffect<void>;
  readonly recordCheckRound: (
    input: RecordCandidateValidationCheckRoundInput,
  ) => StorageEffect<void>;
  readonly recordAcceptanceRound: (
    input: RecordCandidateAcceptanceRoundInput,
  ) => StorageEffect<void>;
  readonly recordSpecialistRound: (
    input: RecordCandidateSpecialistRoundInput,
  ) => StorageEffect<void>;
  readonly settleAgentInvocationRound?: (input: {
    readonly validationRunId: string;
    readonly phase: ValidationPhase;
    readonly producer: string;
    readonly roundNumber: number;
    readonly roundStatus: "passed" | "failed";
    readonly findings: readonly Omit<ValidationRunFindingRecord, "createdAt" | "updatedAt">[];
    readonly artifactRecords: readonly Omit<ValidationRunArtifactRecord, "createdAt">[];
    readonly toolingFailure?: ValidationToolingFailureRecordInput & {
      readonly validationRunId: string;
    };
    readonly now: string;
  }) => AgentSessionSqlLink;
  readonly listRounds: (
    validationRunId: string,
  ) => StorageEffect<readonly CandidateValidationRound[]>;
  readonly listFindings: (
    validationRunId: string,
  ) => StorageEffect<readonly CandidateValidationFinding[]>;
  readonly listPreviousCandidateReviewerFindings: (input: {
    readonly candidateId: string;
    readonly phase: ValidationPhase;
    readonly producer: string;
  }) => StorageEffect<readonly CandidateValidationFinding[]>;
  readonly listToolingFailures: (
    validationRunId: string,
  ) => StorageEffect<readonly CandidateValidationToolingFailure[]>;
  readonly listArtifacts: (
    validationRunId: string,
  ) => StorageEffect<readonly CandidateValidationArtifact[]>;
};

export type ChangeValidationReadPort = {
  readonly getCandidateById: (candidateId: string) => StorageEffect<CandidateRecord | undefined>;
  readonly getCurrentCandidateForChange: (
    changeId: string,
  ) => StorageEffect<CandidateRecord | undefined>;
  readonly listCandidatesForChange: (changeId: string) => StorageEffect<readonly CandidateRecord[]>;
  readonly getRunById: (
    validationRunId: string,
  ) => StorageEffect<CandidateValidationRunRecord | undefined>;
  readonly listRunsForCandidate: (
    candidateId: string,
  ) => StorageEffect<readonly CandidateValidationRunRecord[]>;
  readonly listRounds: CandidateValidationExecutionPort["listRounds"];
  readonly listFindings: CandidateValidationExecutionPort["listFindings"];
  readonly listToolingFailures: CandidateValidationExecutionPort["listToolingFailures"];
  readonly listArtifacts: CandidateValidationExecutionPort["listArtifacts"];
  readonly listAgentInvocations?: (
    validationRunId: string,
  ) => StorageEffect<readonly CandidateValidationAgentInvocation[]>;
};

export type ActiveValidationRunPort = {
  readonly getActiveForChange: (
    changeId: string,
  ) => StorageEffect<ActiveCandidateValidationRun | undefined>;
};

export type ValidationRunAbandonmentPort = {
  readonly getAbandonmentContext: (
    validationRunId: string,
  ) => StorageEffect<CandidateValidationRunAbandonmentContext | undefined>;
  readonly getRunById: ChangeValidationReadPort["getRunById"];
  readonly recordToolingFailure: CandidateValidationExecutionPort["recordToolingFailure"];
  readonly abandon: (input: AbandonCandidateValidationRunInput) => StorageEffect<void>;
};

export type ValidationArtifactLifecyclePort = {
  readonly listRunIdsForChange: (changeId: string) => StorageEffect<readonly string[]>;
};
