import type { CandidateRecord } from "../candidate/candidate.js";
import type { ImplementationBlockerHistory } from "../implementationBlocker.js";
import type { ImplementationDecision } from "../implementationDecision.js";
import type { ValidationToolingFailureRecordInput } from "../validation/validationToolingFailures.js";
import type {
  ValidationPhase,
  ValidationRunArtifactRecord,
  ValidationRunFindingRecord,
} from "../validationRun/validationRun.js";
import type { CandidateValidationPolicySnapshot } from "./candidateValidationPolicySnapshot.js";

export type CandidateValidationOutcome = "passed" | "blocked" | "tooling_failed";

export type RecordCandidateValidationCommandRoundInput = {
  readonly validationRunId: string;
  readonly phase: ValidationPhase;
  readonly producer: string;
  readonly roundNumber: number;
  readonly roundStatus: "passed" | "failed";
  readonly artifactRecords: readonly Omit<ValidationRunArtifactRecord, "createdAt">[];
  readonly finding?: Omit<ValidationRunFindingRecord, "createdAt" | "updatedAt">;
  readonly findings?: readonly Omit<ValidationRunFindingRecord, "createdAt" | "updatedAt">[];
  readonly now: string;
};

export type RecordCandidateValidationCheckRoundInput = Omit<
  RecordCandidateValidationCommandRoundInput,
  "phase"
>;

export type RecordCandidateValidationPrepareRoundInput = Omit<
  RecordCandidateValidationCommandRoundInput,
  "phase" | "producer"
>;

export type StartCandidateValidationRunInput = {
  readonly candidateId: string;
  readonly headSha: string;
  readonly changeBaseSha?: string;
  readonly policy: Omit<CandidateValidationPolicySnapshot, "acceptanceContext">;
  readonly validationRunId?: string;
  readonly workspaceSetup?: {
    readonly worktreePath: string;
  };
  readonly now: string;
};

export type CandidateValidationAuthority = {
  readonly candidate: CandidateRecord;
  readonly policy: CandidateValidationPolicySnapshot;
  readonly implementationDecisions: readonly ImplementationDecision[];
  readonly blockerHistory: ImplementationBlockerHistory;
  readonly latestResolvedBlockerId: string | null;
};

export type StartCandidateValidationRunResult =
  | {
      readonly reused: true;
      readonly validationRunId: string;
      readonly outcome: "passed";
      readonly authority: CandidateValidationAuthority;
    }
  | {
      readonly reused: false;
      readonly validationRunId: string;
      readonly authority: CandidateValidationAuthority;
    }
  | { readonly reused: false; readonly active: true; readonly validationRunId: string }
  | { readonly reused: false; readonly blocked: true };

export type CompleteCandidateValidationRunInput = {
  readonly validationRunId: string;
  readonly outcome: CandidateValidationOutcome;
  readonly now: string;
};

export type RecordCandidateAcceptanceRoundInput = Omit<
  RecordCandidateValidationCommandRoundInput,
  "phase" | "producer" | "finding"
> & {
  readonly findings: NonNullable<RecordCandidateValidationCommandRoundInput["findings"]>;
};

export type RecordCandidateSpecialistRoundInput = Omit<
  RecordCandidateValidationCommandRoundInput,
  "phase" | "finding"
> & {
  readonly findings: NonNullable<RecordCandidateValidationCommandRoundInput["findings"]>;
};

export type RecordCandidateWorkspaceCleanupInput = {
  readonly validationRunId: string;
  readonly cleanupWorkspace: "removed" | "not_created" | "failed";
};

export type AbandonCandidateValidationRunInput = {
  readonly validationRunId: string;
  readonly errorKind: string;
  readonly operationName: string;
  readonly errorMessage: string;
  readonly now: string;
};

export type RecordCandidateToolingFailureInput = ValidationToolingFailureRecordInput & {
  readonly validationRunId: string;
  readonly now: string;
};

export type ActiveCandidateValidationRun = {
  readonly validationRunId: string;
  readonly changeId: string;
};

export type CandidateValidationRunAbandonmentContext = {
  readonly validationRunId: string;
  readonly changeId: string;
  readonly candidateId: string;
  readonly submittedSha: string;
  readonly worktreePath?: string;
  readonly cleanupWorkspace: "removed" | "not_created" | "failed" | null;
};

export type CandidateValidationRunRecord = {
  readonly id: string;
  readonly candidateId: string;
  readonly policy: CandidateValidationPolicySnapshot;
  readonly implementationDecisions: readonly ImplementationDecision[];
  readonly state: "running" | "complete";
  readonly outcome: CandidateValidationOutcome | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type CandidateValidationRound = {
  readonly validationRunId: string;
  readonly phase: ValidationPhase;
  readonly producer: string;
  readonly roundNumber: number;
  readonly status: "passed" | "failed";
  readonly createdAt: string;
};

export type CandidateValidationFinding = ValidationRunFindingRecord;

export type CandidateValidationToolingFailure = {
  readonly sequence: number;
  readonly validationRunId: string;
  readonly errorKind: string;
  readonly operationName: string;
  readonly errorMessage: string;
  readonly createdAt: string;
};

export type CandidateValidationArtifact = {
  readonly ref: string;
  readonly validationRunId: string;
  readonly phase: ValidationPhase;
  readonly producer: string;
  readonly path: string;
  readonly originalBytes: number;
  readonly storedBytes: number;
  readonly truncated: boolean;
  readonly createdAt: string;
};
