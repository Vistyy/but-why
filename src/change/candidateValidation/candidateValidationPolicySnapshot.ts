import { Schema } from "effect";

import { configNameSchema, nonBlankStringSchema } from "../../contracts/agentConfig.js";
import { checkIdSchema, timeoutSecondsSchema } from "../../contracts/repoConfig.js";
import { acceptanceContextSnapshotSchema } from "../validationRun/acceptanceContextSnapshot.js";

const piRuntimeConfigSnapshotSchema = Schema.Struct({
  model: Schema.optional(nonBlankStringSchema),
  thinking: Schema.optional(Schema.Literal("off", "minimal", "low", "medium", "high", "xhigh")),
  extensions: Schema.optional(Schema.Array(nonBlankStringSchema)),
  skills: Schema.optional(Schema.Array(nonBlankStringSchema)),
  tools: Schema.optional(Schema.Array(nonBlankStringSchema)),
  contextFileDiscovery: Schema.optional(Schema.Boolean),
});

const piAgentProfileConfigSnapshotSchema = Schema.Struct({
  agentRuntime: Schema.Literal("pi"),
  runtimeConfig: Schema.optional(piRuntimeConfigSnapshotSchema),
});

export const resolvedPiAgentProfileSnapshotSchema = Schema.Struct({
  agentProfile: configNameSchema,
  scope: Schema.Literal("repo", "global"),
  profile: piAgentProfileConfigSnapshotSchema,
  globalConfigDirectory: Schema.optionalWith(nonBlankStringSchema, { exact: true }),
});

const prepareSnapshotSchema = Schema.Struct({
  command: nonBlankStringSchema,
  timeoutSeconds: timeoutSecondsSchema,
});

const checkSnapshotSchema = Schema.Struct({
  id: checkIdSchema,
  command: nonBlankStringSchema,
  timeoutSeconds: timeoutSecondsSchema,
});

export const acceptanceReviewPolicySnapshotSchema = Schema.Struct({
  instructions: nonBlankStringSchema,
  instructionsSource: Schema.Literal("repo", "global", "built_in"),
  profile: resolvedPiAgentProfileSnapshotSchema,
});

export const specialistReviewPolicySnapshotSchema = Schema.Struct({
  id: configNameSchema,
  instructions: nonBlankStringSchema,
  instructionsSource: Schema.Literal("repo", "global"),
  profile: resolvedPiAgentProfileSnapshotSchema,
});

export const candidateValidationPolicySnapshotSchema = Schema.Struct({
  acceptanceContext: Schema.optional(acceptanceContextSnapshotSchema),
  agentEnvironment: Schema.optional(Schema.Array(nonBlankStringSchema)),
  prepare: Schema.optional(prepareSnapshotSchema),
  checks: Schema.Array(checkSnapshotSchema),
  copyFiles: Schema.Array(nonBlankStringSchema),
  acceptanceReview: Schema.optional(acceptanceReviewPolicySnapshotSchema),
  specialistReviews: Schema.optional(Schema.Array(specialistReviewPolicySnapshotSchema)),
}).pipe(
  Schema.filter((policy) => unique(policy.checks.map((check) => check.id)), {
    message: () => "Validation Check IDs must be unique",
  }),
  Schema.filter(
    (policy) =>
      unique((policy.specialistReviews ?? []).map((review) => review.id)) &&
      (policy.specialistReviews ?? []).every((review) => review.id !== "acceptance"),
    { message: () => "Specialist IDs must be unique and must not use acceptance" },
  ),
);

export type CandidateValidationPolicySnapshot = Schema.Schema.Type<
  typeof candidateValidationPolicySnapshotSchema
>;

const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;
