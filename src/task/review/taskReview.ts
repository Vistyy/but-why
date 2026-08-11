import type { ResolvedPiAgentProfile } from "../../agent/agentProfiles.js";
import type { ReviewerFindingCore } from "../../contracts/reviewerFinding.js";
import type { DisposableWorkspaceCleanupState } from "../../disposableWorkspace/disposableWorkspace.js";

export type TaskReviewOutcome = "passed" | "blocked" | "tooling_failed";

export type TaskReviewBase = { readonly ref: string; readonly commit: string };

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

export type TaskReviewPolicySnapshotV1 = {
  readonly id: "task_advisory_review";
  readonly version: 1;
  readonly agentProfile: string;
  readonly profileScope: "global";
  readonly instructions: string;
};

export type TaskReviewPolicySnapshotV2 = {
  readonly id: "task_advisory_review";
  readonly version: 2;
  readonly profile: Pick<ResolvedPiAgentProfile, "agentProfile" | "scope" | "profile">;
  readonly builtInInstructions: string;
  readonly guidance: {
    readonly content: string;
    readonly source: "repo" | "global";
  } | null;
};

export type TaskReviewPolicySnapshot = TaskReviewPolicySnapshotV1 | TaskReviewPolicySnapshotV2;

export type TaskReviewToolingFailure = {
  readonly operation: string;
  readonly message: string;
};

export type TaskReviewFinding = ReviewerFindingCore & {
  readonly artifactRefs: readonly string[];
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
  readonly findings: readonly TaskReviewFinding[];
  readonly createdAt: string;
  readonly updatedAt: string;
};
