import type { Effect } from "effect";

import type { CandidateRecord } from "../candidate/candidate.js";
import type {
  CandidateValidationArtifact,
  CandidateValidationFinding,
  CandidateValidationRound,
  CandidateValidationRunRecord,
  CandidateValidationToolingFailure,
  CompleteCandidateValidationRunInput,
  RecordCandidateAcceptanceRoundInput,
  RecordCandidateSpecialistRoundInput,
  RecordCandidateToolingFailureInput,
  RecordCandidateValidationCheckRoundInput,
  RecordCandidateValidationPrepareRoundInput,
  RecordCandidateWorkspaceSetupInput,
  StartCandidateValidationRunInput,
  StartCandidateValidationRunResult,
} from "../candidateValidation/candidateValidationRunStore.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { ValidationPhase } from "../validationRun/validationRun.js";

type StorageEffect<A> = Effect.Effect<A, RepositoryStorageError>;

export type ChangeValidationPersistence = {
  readonly getCandidateById: (candidateId: string) => StorageEffect<CandidateRecord | undefined>;
  readonly listCandidatesForChange: (changeId: string) => StorageEffect<readonly CandidateRecord[]>;
  readonly startOrReuse: (
    input: StartCandidateValidationRunInput,
  ) => StorageEffect<StartCandidateValidationRunResult>;
  readonly complete: (input: CompleteCandidateValidationRunInput) => StorageEffect<void>;
  readonly getRunById: (
    validationRunId: string,
  ) => StorageEffect<CandidateValidationRunRecord | undefined>;
  readonly listRunsForCandidate: (
    candidateId: string,
  ) => StorageEffect<readonly CandidateValidationRunRecord[]>;
  readonly recordWorkspaceSetup: (input: RecordCandidateWorkspaceSetupInput) => StorageEffect<void>;
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
