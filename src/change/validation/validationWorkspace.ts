import type { Sandbox } from "@ai-hero/sandcastle";
import type { CandidateValidationOutcome } from "../candidateValidation/candidateValidationRunStore.js";
import type { SpecialistReviewerContinuityEvidence } from "../specialistReview/runSpecialistReviewPhase.js";
import type { CleanupState } from "../validationRun/cleanup.js";
import type { ReviewerExecutionEvidence } from "../validationRun/reviewerArtifacts.js";
import type { ValidationToolingFailure } from "./validationToolingFailures.js";

export type ValidationWorkspaceCleanupResult = {
  readonly worktree: CleanupState;
  readonly tempRef: CleanupState;
};

export type ActiveValidationWorkspace = {
  readonly sandbox: Pick<Sandbox, "exec" | "run">;
  readonly worktreePath: string;
};

export type ActiveValidationWorkspaceResult = {
  readonly outcome: CandidateValidationOutcome;
  readonly reviewerEvidence?: ReviewerExecutionEvidence;
  readonly specialistReviewerEvidence?: readonly SpecialistReviewerContinuityEvidence[];
  readonly toolingFailures: readonly ValidationToolingFailure[];
};

export type ValidationWorkspaceSetup = {
  readonly validationRunId: string;
  readonly tempRefName: string;
  readonly submittedSha: string;
  readonly worktreeHead: string;
  readonly worktreePath?: string;
  readonly cleanupResult: ValidationWorkspaceCleanupResult;
};

export type ValidationWorkspaceToolingError = {
  readonly operationName: string;
  readonly tempRefName: string;
  readonly submittedSha: string;
  readonly worktreePath?: string;
  readonly errorMessage: string;
  readonly cleanupResult: ValidationWorkspaceCleanupResult;
};
