import type { ResolvedPiAgentProfile } from "../../agent/agentProfiles.js";
import type { AgentInvocationRecord } from "../../agent/agentSession/agentSession.js";
import type { PiAgentProfileConfig } from "../../contracts/agentConfig.js";
import type { ReviewerFindingCore } from "../../contracts/reviewerFinding.js";

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

export type TaskReviewPolicySnapshot = {
  readonly profile: Pick<ResolvedPiAgentProfile, "agentProfile" | "scope"> & {
    readonly profile: PiAgentProfileConfig | null;
  };
  readonly builtInInstructions: string;
  readonly guidance: {
    readonly content: string;
    readonly source: "repo" | "global";
  } | null;
};

export type TaskReviewToolingFailure = {
  readonly operation: string;
  readonly message: string;
};

export type TaskReviewFinding = ReviewerFindingCore;

export type TaskReviewRecord = {
  readonly id: number;
  readonly taskId: string;
  readonly proposal: TaskReviewProposal;
  readonly dependencyEvidence: readonly TaskReviewDependencyEvidence[];
  readonly baseRef: string;
  readonly baseCommit: string;
  readonly workspacePath: string;
  readonly state: "running" | "complete";
  readonly outcome: TaskReviewOutcome | null;
  readonly workspaceCleanup: "not_created" | "removed" | "failed";
  readonly cleanupBlockingReason: string | null;
  readonly toolingFailure: TaskReviewToolingFailure | null;
  readonly findings: readonly TaskReviewFinding[];
  readonly agentSessionId?: number;
  readonly agentInvocations?: readonly AgentInvocationRecord[];
  readonly reviewerConfiguration?: TaskReviewPolicySnapshot;
};
