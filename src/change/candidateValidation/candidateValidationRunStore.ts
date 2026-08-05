import type { AgentEnvironmentCommand } from "../../agent/agentEnvironment.js";
import type { ImplementationDecision } from "../implementationDecision.js";
import type { AcceptanceContextSnapshotV1 } from "../validationRun/acceptanceContextSnapshot.js";
import type { ResolvedPiAgentProfile } from "../../agent/agentProfiles.js";
import type { ValidationToolingFailureRecordInput } from "../validation/validationToolingFailures.js";
import type {
  ValidationPhase,
  ValidationRunArtifactRecord,
  ValidationRunFindingRecord,
} from "../validationRun/validationRun.js";

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

export type CandidateValidationPolicySnapshot = {
  readonly acceptanceContext?: AcceptanceContextSnapshotV1;
  readonly agentEnvironment?: AgentEnvironmentCommand;
  readonly prepare?: { readonly command: string; readonly timeoutSeconds: number };
  readonly checks: readonly {
    readonly id: string;
    readonly command: string;
    readonly timeoutSeconds: number;
  }[];
  readonly copyFiles: readonly string[];
  readonly acceptanceReview?: {
    readonly instructions: string;
    readonly instructionsSource: "repo" | "global" | "built_in";
    readonly agentProfile: string;
    readonly profileScope: "repo" | "global";
    readonly profile: ResolvedPiAgentProfile;
  };
  readonly specialistReviews?: readonly {
    readonly id: string;
    readonly instructions: string;
    readonly instructionsSource: "repo" | "global";
    readonly agentProfile: string;
    readonly profileScope: "repo" | "global";
    readonly profile: ResolvedPiAgentProfile;
  }[];
};

export type StartCandidateValidationRunInput = {
  readonly candidateId: string;
  readonly headSha: string;
  readonly changeBaseSha?: string;
  readonly policy: CandidateValidationPolicySnapshot;
  readonly implementationDecisions?: readonly ImplementationDecision[];
  readonly validationRunId?: string;
  readonly workspaceSetup?: {
    readonly tempRefName: string;
    readonly worktreePath: string;
  };
  readonly now: string;
};

export type StartCandidateValidationRunResult =
  | { readonly reused: true; readonly validationRunId: string; readonly outcome: "passed" }
  | { readonly reused: false; readonly validationRunId: string }
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

export type RecordCandidateWorkspaceSetupInput = {
  readonly validationRunId: string;
  readonly tempRefName: string;
  readonly submittedSha: string;
  readonly worktreeHead: string;
  readonly worktreePath?: string;
  readonly cleanupWorktree: string;
  readonly cleanupTempRef: string;
  readonly now: string;
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
  readonly tempRefName?: string;
  readonly worktreePath?: string;
  readonly cleanupWorktree: "removed" | "not_created" | "failed" | null;
  readonly cleanupTempRef: "removed" | "not_created" | "failed" | null;
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
