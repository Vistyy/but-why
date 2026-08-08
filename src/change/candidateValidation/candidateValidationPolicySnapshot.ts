import { Schema } from "effect";

const acceptanceContextSnapshotSchema = Schema.Struct({
  version: Schema.Literal(1),
  title: Schema.String,
  description: Schema.String,
  comments: Schema.optional(Schema.Array(Schema.String)),
  resolutions: Schema.optional(Schema.Array(Schema.String)),
});

const piRuntimeConfigSnapshotSchema = Schema.Struct({
  model: Schema.optional(Schema.String),
  thinking: Schema.optional(Schema.Literal("off", "minimal", "low", "medium", "high", "xhigh")),
  extensions: Schema.optional(Schema.Array(Schema.String)),
  skills: Schema.optional(Schema.Array(Schema.String)),
  tools: Schema.optional(Schema.Array(Schema.String)),
  contextFileDiscovery: Schema.optional(Schema.Boolean),
});

const piAgentProfileConfigSnapshotSchema = Schema.Struct({
  agentRuntime: Schema.Literal("pi"),
  runtimeConfig: Schema.optional(piRuntimeConfigSnapshotSchema),
});

const resolvedPiAgentProfileSnapshotSchema = Schema.Struct({
  agentProfile: Schema.String,
  scope: Schema.Literal("repo", "global"),
  profile: piAgentProfileConfigSnapshotSchema,
});

const prepareSnapshotSchema = Schema.Struct({
  command: Schema.String,
  timeoutSeconds: Schema.Number,
});

const checkSnapshotSchema = Schema.Struct({
  id: Schema.String,
  command: Schema.String,
  timeoutSeconds: Schema.Number,
});

const acceptanceReviewPolicySnapshotSchema = Schema.Struct({
  instructions: Schema.String,
  instructionsSource: Schema.Literal("repo", "global", "built_in"),
  profile: resolvedPiAgentProfileSnapshotSchema,
});

const specialistReviewPolicySnapshotSchema = Schema.Struct({
  id: Schema.String,
  instructions: Schema.String,
  instructionsSource: Schema.Literal("repo", "global"),
  profile: resolvedPiAgentProfileSnapshotSchema,
});

export const candidateValidationPolicySnapshotSchema = Schema.Struct({
  acceptanceContext: Schema.optional(acceptanceContextSnapshotSchema),
  agentEnvironment: Schema.optional(Schema.Array(Schema.String)),
  prepare: Schema.optional(prepareSnapshotSchema),
  checks: Schema.Array(checkSnapshotSchema),
  copyFiles: Schema.Array(Schema.String),
  acceptanceReview: Schema.optional(acceptanceReviewPolicySnapshotSchema),
  specialistReviews: Schema.optional(Schema.Array(specialistReviewPolicySnapshotSchema)),
});

export type CandidateValidationPolicySnapshot = Schema.Schema.Type<
  typeof candidateValidationPolicySnapshotSchema
>;
