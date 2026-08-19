import { Schema } from "effect";
import { resolvedReviewerPiAgentProfileSchema } from "../../agent/agentProfiles.js";
import type { AgentInvocationRecord } from "../../agent/agentSession/agentSession.js";
import { nonBlankStringSchema } from "../../contracts/agentConfig.js";
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

const taskReviewPolicySnapshotSchema = Schema.Struct({
  profile: resolvedReviewerPiAgentProfileSchema,
  builtInInstructions: nonBlankStringSchema,
  guidance: Schema.NullOr(
    Schema.Struct({
      content: nonBlankStringSchema,
      source: Schema.Literal("repo", "global"),
    }),
  ),
});

const decodePolicySnapshot = Schema.decodeUnknownSync(taskReviewPolicySnapshotSchema, {
  onExcessProperty: "error",
});

export const decodeTaskReviewPolicySnapshot = (value: unknown): TaskReviewPolicySnapshot =>
  decodePolicySnapshot(value);

export type TaskReviewPolicySnapshot = Schema.Schema.Type<typeof taskReviewPolicySnapshotSchema>;

const taskReviewToolingFailureSchema = Schema.Struct({
  operation: nonBlankStringSchema,
  message: nonBlankStringSchema,
});

const decodeToolingFailure = Schema.decodeUnknownSync(taskReviewToolingFailureSchema, {
  onExcessProperty: "error",
});

export const decodeTaskReviewToolingFailure = (value: unknown): TaskReviewToolingFailure =>
  decodeToolingFailure(value);

export type TaskReviewToolingFailure = Schema.Schema.Type<typeof taskReviewToolingFailureSchema>;

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
