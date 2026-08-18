import type { AgentInvocationRecord } from "../../agent/agentSession/agentSession.js";
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

export type RecordCandidateValidationPhaseResultInput = {
  readonly validationRunId: number;
  readonly phase: ValidationPhase;
  readonly producer: string;
  readonly outcome: "passed" | "failed";
  readonly artifactRecords: readonly ValidationRunArtifactRecord[];
  readonly finding?: ValidationRunFindingRecord;
  readonly findings?: readonly ValidationRunFindingRecord[];
  readonly toolingFailure?: ValidationToolingFailureRecordInput & {
    readonly validationRunId: number;
  };
};

export type RecordCandidateValidationCheckResultInput = Omit<
  RecordCandidateValidationPhaseResultInput,
  "phase"
>;

export type RecordCandidateValidationPrepareResultInput = Omit<
  RecordCandidateValidationPhaseResultInput,
  "phase" | "producer"
>;

export type StartCandidateValidationRunInput = {
  readonly candidateId: number;
  readonly headSha: string;
  readonly changeBaseSha?: string;
  readonly policy: Omit<CandidateValidationPolicySnapshot, "acceptanceContext">;
};

export type CandidateValidationAuthority = {
  readonly candidate: CandidateRecord;
  readonly policy: CandidateValidationPolicySnapshot;
  readonly implementationDecisions: readonly ImplementationDecision[];
  readonly blockerHistory: ImplementationBlockerHistory;
  readonly latestResolvedBlockerId: number | null;
};

export type StartCandidateValidationRunResult =
  | {
      readonly reused: true;
      readonly validationRunId: number;
      readonly outcome: "passed";
    }
  | {
      readonly reused: false;
      readonly validationRunId: number;
      readonly authority: CandidateValidationAuthority;
    }
  | { readonly reused: false; readonly active: true; readonly validationRunId: number }
  | { readonly reused: false; readonly blocked: true };

export type CompleteCandidateValidationRunInput = {
  readonly validationRunId: number;
  readonly outcome: CandidateValidationOutcome;
};

export type RecordCandidateAcceptanceResultInput = Omit<
  RecordCandidateValidationPhaseResultInput,
  "phase" | "producer" | "finding"
> & {
  readonly findings: NonNullable<RecordCandidateValidationPhaseResultInput["findings"]>;
};

export type RecordCandidateSpecialistResultInput = Omit<
  RecordCandidateValidationPhaseResultInput,
  "phase" | "finding"
> & {
  readonly findings: NonNullable<RecordCandidateValidationPhaseResultInput["findings"]>;
};

export type RecordCandidateWorkspaceCleanupInput = {
  readonly validationRunId: number;
  readonly cleanupWorkspace: "removed" | "not_created" | "failed";
};

export type AbandonCandidateValidationRunInput = {
  readonly validationRunId: number;
  readonly errorKind: string;
  readonly operationName: string;
  readonly errorMessage: string;
  readonly now: string;
};

export type RecordCandidateToolingFailureInput = ValidationToolingFailureRecordInput & {
  readonly validationRunId: number;
};

export type ActiveCandidateValidationRun = {
  readonly validationRunId: number;
  readonly changeId: string;
};

export type CandidateValidationRunAbandonmentContext = {
  readonly validationRunId: number;
  readonly changeId: string;
  readonly candidateId: number;
  readonly submittedSha: string;
  readonly worktreePath?: string;
};

export type CandidateValidationRunRecord = {
  readonly id: number;
  readonly candidateId: number;
  readonly policy: CandidateValidationPolicySnapshot;
  readonly implementationDecisions: readonly ImplementationDecision[];
  readonly state: "running" | "complete";
  readonly outcome: CandidateValidationOutcome | null;
  readonly cleanup: {
    readonly state: "pending" | "complete";
    readonly blockingReason: string | null;
  };
};

export type CandidateValidationAgentInvocation = AgentInvocationRecord & {
  readonly phase: ValidationPhase;
  readonly producer: string;
};

export type CandidateValidationPhaseResult = {
  readonly validationRunId: number;
  readonly phase: ValidationPhase;
  readonly producer: string;
  readonly outcome: "passed" | "failed";
};

export type CandidateValidationFinding = ValidationRunFindingRecord;

export type CandidateValidationToolingFailure = {
  readonly sequence: number;
  readonly validationRunId: number;
  readonly errorKind: string;
  readonly operationName: string;
  readonly errorMessage: string;
};

export type CandidateValidationArtifact = {
  readonly ref: string;
  readonly validationRunId: number;
  readonly phase: ValidationPhase;
  readonly producer: string;
  readonly path: string;
  readonly originalBytes: number;
  readonly storedBytes: number;
  readonly truncated: boolean;
};
