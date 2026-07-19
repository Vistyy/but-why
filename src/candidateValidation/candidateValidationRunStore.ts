import type { ResolvedPiAgentProfile } from "../agent/agentProfiles.js";
import type {
  RecordValidationRunCheckRoundInput,
  RecordValidationRunCommandRoundInput,
  RecordValidationRunPrepareRoundInput,
} from "../validationRun/validationRunStore.js";
import type { ValidationToolingFailureRecordInput } from "../validation/validationToolingFailures.js";
import type {
  ValidationPhase,
  ValidationRunFindingRecord,
} from "../validationRun/validationRun.js";

export type CandidateValidationOutcome = "passed" | "blocked" | "tooling_failed";

export type CandidateValidationRunStore = {
  readonly startOrReuse: (
    input: StartCandidateValidationRunInput,
  ) => StartCandidateValidationRunResult;
  readonly complete: (input: CompleteCandidateValidationRunInput) => void;
  readonly getRunById: (validationRunId: string) => CandidateValidationRunRecord | undefined;
  readonly recordWorkspaceSetup: (input: RecordCandidateWorkspaceSetupInput) => void;
  readonly recordToolingFailure: (input: RecordCandidateToolingFailureInput) => void;
  readonly recordPrepareRound: (input: RecordValidationRunPrepareRoundInput) => void;
  readonly recordCheckRound: (input: RecordValidationRunCheckRoundInput) => void;
  readonly recordAcceptanceRound: (input: RecordCandidateAcceptanceRoundInput) => void;
  readonly recordSpecialistRound: (input: RecordCandidateSpecialistRoundInput) => void;
  readonly listRounds: (validationRunId: string) => readonly CandidateValidationRound[];
  readonly listFindings: (validationRunId: string) => readonly CandidateValidationFinding[];
  readonly listToolingFailures: (
    validationRunId: string,
  ) => readonly CandidateValidationToolingFailure[];
  readonly listArtifacts: (validationRunId: string) => readonly CandidateValidationArtifact[];
};

export type CandidateValidationPolicySnapshot = {
  readonly sandboxMode: string;
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
    readonly profileSource: "repo" | "global";
    readonly profile: ResolvedPiAgentProfile;
  };
  readonly specialistReviews?: readonly {
    readonly id: string;
    readonly instructions: string;
    readonly instructionsSource: "repo" | "global";
    readonly agentProfile: string;
    readonly profileSource: "repo" | "global";
    readonly profile: ResolvedPiAgentProfile;
  }[];
};

export type StartCandidateValidationRunInput = {
  readonly candidateId: string;
  readonly headSha: string;
  readonly comparisonBaseSha?: string;
  readonly policy: CandidateValidationPolicySnapshot;
  readonly now: string;
};

export type StartCandidateValidationRunResult =
  | { readonly reused: true; readonly validationRunId: string; readonly outcome: "passed" }
  | { readonly reused: false; readonly validationRunId: string };

export type CompleteCandidateValidationRunInput = {
  readonly validationRunId: string;
  readonly outcome: CandidateValidationOutcome;
  readonly now: string;
};

export type RecordCandidateAcceptanceRoundInput = Omit<
  RecordValidationRunCommandRoundInput,
  "phase" | "producer" | "finding"
> & {
  readonly findings: NonNullable<RecordValidationRunCommandRoundInput["findings"]>;
};

export type RecordCandidateSpecialistRoundInput = Omit<
  RecordValidationRunCommandRoundInput,
  "phase" | "finding"
> & {
  readonly findings: NonNullable<RecordValidationRunCommandRoundInput["findings"]>;
};

export type RecordCandidateWorkspaceSetupInput = {
  readonly validationRunId: string;
  readonly tempRefName: string;
  readonly submittedSha: string;
  readonly worktreeHead: string;
  readonly cleanupWorktree: string;
  readonly cleanupTempRef: string;
  readonly now: string;
};

export type RecordCandidateToolingFailureInput = ValidationToolingFailureRecordInput & {
  readonly validationRunId: string;
  readonly now: string;
};

export type CandidateValidationRunRecord = {
  readonly id: string;
  readonly candidateId: string;
  readonly policy: CandidateValidationPolicySnapshot;
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
