import type { WorkspaceCommandExecutor } from "../../command/workspaceCommand.js";
import type { CandidateValidationOutcome } from "../candidateValidation/candidateValidationRunStore.js";
import type { SpecialistReviewerContinuityEvidence } from "../specialistReview/runSpecialistReviewPhase.js";
import type { CleanupState } from "../validationRun/cleanup.js";
import type { ReviewerExecutionEvidence } from "../validationRun/reviewerArtifacts.js";
import type { ValidationToolingFailure } from "./validationToolingFailures.js";

export type SnapshotWorkspaceCleanupResult = {
  readonly workspace: CleanupState;
};

export type ActiveSnapshotWorkspace = {
  readonly commandExecutor: WorkspaceCommandExecutor;
  readonly worktreePath: string;
};

export type ActiveSnapshotWorkspaceResult = {
  readonly outcome: CandidateValidationOutcome;
  readonly reviewerEvidence?: ReviewerExecutionEvidence;
  readonly specialistReviewerEvidence?: readonly SpecialistReviewerContinuityEvidence[];
  readonly toolingFailures: readonly ValidationToolingFailure[];
};

export type SnapshotWorkspaceSetup = {
  readonly validationRunId: string;
  readonly expectedCommitSha: string;
  readonly workspaceHead?: string;
  readonly worktreePath: string;
  readonly cleanupResult: SnapshotWorkspaceCleanupResult;
};

export type SnapshotWorkspaceToolingError = {
  readonly operationName: string;
  readonly validationRunId: string;
  readonly expectedCommitSha: string;
  readonly worktreePath: string;
  readonly errorMessage: string;
  readonly cleanupResult: SnapshotWorkspaceCleanupResult;
};
