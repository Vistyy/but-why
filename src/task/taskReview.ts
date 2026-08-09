import { Schema } from "effect";

import { nonBlankStringSchema } from "../contracts/agentConfig.js";
import type { TaskState } from "./lifecycle.js";
import { type PublicTaskId, storedPublicTaskId } from "./taskId.js";

export type TaskReviewOutcome = "passed" | "blocked" | "tooling_failed";

export type TaskReviewProposalDependency = {
  readonly taskId: PublicTaskId;
  readonly title: string;
  readonly state: TaskState;
};

export type TaskReviewProposal = {
  readonly title: string;
  readonly description: string;
  readonly dependencies: readonly TaskReviewProposalDependency[];
};

export type TaskReviewProposalKey = {
  readonly title: string;
  readonly description: string;
  readonly dependencyIds: readonly string[];
};

export const taskReviewPolicySnapshotSchema = Schema.Struct({
  version: Schema.Literal(1),
  instructions: nonBlankStringSchema,
  instructionsSource: Schema.Literal("repo", "global", "built_in"),
  profile: Schema.Struct({
    agentProfile: nonBlankStringSchema,
    scope: Schema.Literal("repo", "global"),
    runtimeConfig: Schema.optional(
      Schema.Struct({
        model: Schema.optional(nonBlankStringSchema),
        thinking: Schema.optional(
          Schema.Literal("off", "minimal", "low", "medium", "high", "xhigh"),
        ),
        extensions: Schema.optional(Schema.Array(nonBlankStringSchema)),
        skills: Schema.optional(Schema.Array(nonBlankStringSchema)),
        tools: Schema.optional(Schema.Array(nonBlankStringSchema)),
      }),
    ),
  }),
});

export type TaskReviewPolicySnapshot = Schema.Schema.Type<typeof taskReviewPolicySnapshotSchema>;

export type TaskReviewRecord = {
  readonly id: string;
  readonly taskId: PublicTaskId;
  readonly proposal: TaskReviewProposal;
  readonly baseCommit: string;
  readonly policy: TaskReviewPolicySnapshot;
  readonly state: "running" | "complete";
  readonly outcome: TaskReviewOutcome | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type TaskReviewFinding = {
  readonly id: string;
  readonly reviewId: string;
  readonly title: string;
  readonly description: string;
  readonly evidence: string;
  readonly files: readonly string[];
  readonly createdAt: string;
};

export type TaskReviewToolingFailure = {
  readonly sequence: number;
  readonly reviewId: string;
  readonly errorKind: string;
  readonly operationName: string;
  readonly errorMessage: string;
  readonly createdAt: string;
};

export type TaskReviewSessionRecord = {
  readonly taskId: PublicTaskId;
  readonly producer: string;
  readonly fingerprint: string;
  readonly sessionReference: string;
};

export type TaskReviewTranscript = {
  readonly taskId: PublicTaskId;
  readonly producer: string;
  readonly piSessionId: string;
  readonly filePath: string;
};

export type TaskReviewWorkspaceSetup = {
  readonly reviewId: string;
  readonly tempRefName: string;
  readonly submittedSha: string;
  readonly worktreeHead: string;
  readonly worktreePath?: string;
  readonly cleanupWorktree: "removed" | "not_created" | "failed" | null;
  readonly cleanupTempRef: "removed" | "not_created" | "failed" | null;
  readonly createdAt: string;
};

export type TaskReviewAbandonmentContext = {
  readonly reviewId: string;
  readonly taskId: PublicTaskId;
  readonly submittedSha: string;
  readonly tempRefName?: string;
  readonly worktreePath?: string;
  readonly cleanupWorktree: "removed" | "not_created" | "failed" | null;
  readonly cleanupTempRef: "removed" | "not_created" | "failed" | null;
};

const persistedTaskReviewProposalSchema = Schema.Struct({
  title: nonBlankStringSchema,
  description: nonBlankStringSchema,
  dependencies: Schema.Array(
    Schema.Struct({
      taskId: nonBlankStringSchema,
      title: nonBlankStringSchema,
      state: Schema.Literal("new", "todo", "done", "cancelled"),
    }),
  ),
});

export const decodePersistedTaskReviewProposal = (value: unknown): TaskReviewProposal => {
  const decoded = Schema.decodeUnknownSync(persistedTaskReviewProposalSchema, {
    onExcessProperty: "error",
  })(value);
  return {
    title: decoded.title,
    description: decoded.description,
    dependencies: decoded.dependencies.map((dependency) => ({
      taskId: storedPublicTaskId(dependency.taskId),
      title: dependency.title,
      state: dependency.state,
    })),
  };
};
