import type { ReviewerFindingCore } from "../../contracts/reviewerFinding.js";
import type { DisposableWorkspaceCleanupState } from "../../disposableWorkspace/disposableWorkspace.js";

export type TaskReviewOutcome = "passed" | "blocked" | "tooling_failed";

export type TaskReviewProposal = {
  readonly title: string;
  readonly description: string;
  readonly dependencyIds: readonly string[];
};

export type TaskReviewDependencyEvidence = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly state: string;
};

export type TaskReviewPolicySnapshot = {
  readonly id: "task_advisory_review";
  readonly version: 1;
  readonly agentProfile: string;
  readonly profileScope: "global";
  readonly instructions: string;
};

export type TaskReviewToolingFailure = {
  readonly operation: string;
  readonly message: string;
};

export type TaskReviewRecord = {
  readonly id: string;
  readonly taskId: string;
  readonly proposal: TaskReviewProposal;
  readonly dependencyEvidence: readonly TaskReviewDependencyEvidence[];
  readonly policy: TaskReviewPolicySnapshot;
  readonly baseRef: string;
  readonly baseCommit: string;
  readonly workspacePath: string;
  readonly state: "running" | "complete";
  readonly outcome: TaskReviewOutcome | null;
  readonly workspaceCleanup: DisposableWorkspaceCleanupState;
  readonly toolingFailure: TaskReviewToolingFailure | null;
  readonly abandonReason: string | null;
  readonly findings: readonly ReviewerFindingCore[];
  readonly createdAt: string;
  readonly updatedAt: string;
};

export const taskReviewInstructions = [
  "Review one exact New Task proposal before Task Approval.",
  "Judge whether the proposal is coherent, implementable, and verifiable as one supported result in this repository.",
  "Treat the selected title, description, and direct Task Dependency identities as the proposal under review.",
  "Use dependency evidence only to understand the observed prerequisites. Later dependency changes cannot alter this review.",
  "Report a Finding for each material ambiguity, contradiction, unsupported outcome, unsafe boundary, missing prerequisite, or verification impossibility that should be resolved before Task Approval.",
  "Do not design the implementation, expand requested intent, require a preferred implementation, or require optional improvement.",
  "Return an empty Findings array when the exact proposal is safe to approve.",
].join("\n");
