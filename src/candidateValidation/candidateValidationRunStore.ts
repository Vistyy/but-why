import type {
  RecordValidationRunCheckRoundInput,
  RecordValidationRunPrepareRoundInput,
} from "../validationRun/validationRunStore.js";
import type { ValidationToolingFailureRecordInput } from "../validation/validationToolingFailures.js";

export type CandidateValidationOutcome = "passed" | "blocked" | "tooling_failed";

export type CandidateValidationRunStore = {
  readonly startOrReuse: (
    input: StartCandidateValidationRunInput,
  ) => StartCandidateValidationRunResult;
  readonly complete: (input: CompleteCandidateValidationRunInput) => void;
  readonly recordWorkspaceSetup: (input: RecordCandidateWorkspaceSetupInput) => void;
  readonly recordToolingFailure: (input: RecordCandidateToolingFailureInput) => void;
  readonly recordPrepareRound: (input: RecordValidationRunPrepareRoundInput) => void;
  readonly recordCheckRound: (input: RecordValidationRunCheckRoundInput) => void;
  readonly listRounds: (validationRunId: string) => readonly CandidateValidationRound[];
  readonly listFindings: (validationRunId: string) => readonly CandidateValidationFinding[];
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
};

export type StartCandidateValidationRunInput = {
  readonly candidateId: string;
  readonly headSha: string;
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

export type CandidateValidationRound = {
  readonly producer: string;
  readonly status: "passed" | "failed";
};

export type CandidateValidationFinding = {
  readonly id: string;
  readonly producer: string;
};
