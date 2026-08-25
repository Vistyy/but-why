import { Schema } from "effect";
import { resolvedReviewerPiAgentProfileSchema } from "../agent/agentProfiles.js";
import { validatePiAgentProfileResources } from "../agent/piRuntime.js";
import {
  configNameSchema,
  isPackageAgentResource,
  nonBlankStringSchema,
} from "../contracts/agentConfig.js";
import type { ChangeReviewerConfiguration } from "./changePolicy.js";

const acceptanceReviewPolicySnapshotSchema = Schema.Struct({
  instructions: nonBlankStringSchema,
  instructionsSource: Schema.Literal("repo", "global", "built_in"),
  profile: resolvedReviewerPiAgentProfileSchema,
});

const specialistReviewPolicySnapshotSchema = Schema.Struct({
  id: configNameSchema,
  instructions: nonBlankStringSchema,
  instructionsSource: Schema.Literal("repo", "global"),
  profile: resolvedReviewerPiAgentProfileSchema,
});

const changeReviewerConfigurationSchema = Schema.Struct({
  acceptanceReview: Schema.NullOr(acceptanceReviewPolicySnapshotSchema),
  specialistReviews: Schema.Array(specialistReviewPolicySnapshotSchema),
  agentEnvironment: Schema.optionalWith(Schema.NonEmptyArray(nonBlankStringSchema), {
    exact: true,
  }),
  stallDetector: Schema.optionalWith(
    Schema.Struct({
      prompt: nonBlankStringSchema,
      responseContract: nonBlankStringSchema,
    }),
    { exact: true },
  ),
}).pipe(
  Schema.filter(
    (configuration) => {
      const ids = configuration.specialistReviews.map((review) => review.id);
      return new Set(ids).size === ids.length && ids.every((id) => id !== "acceptance");
    },
    { message: () => "Specialist IDs must be unique and must not use acceptance" },
  ),
);

const decodeConfiguration = Schema.decodeUnknownSync(changeReviewerConfigurationSchema, {
  onExcessProperty: "error",
});

export const decodeChangeReviewerConfiguration = (value: unknown): ChangeReviewerConfiguration =>
  decodeConfiguration(value);

export const decodeSqliteChangeReviewerConfiguration = (
  source: string,
): ChangeReviewerConfiguration => decodeChangeReviewerConfiguration(JSON.parse(source) as unknown);

export const encodeSqliteChangeReviewerConfiguration = (
  configuration: ChangeReviewerConfiguration,
): string => JSON.stringify(decodeChangeReviewerConfiguration(configuration));

export type ChangeReviewerPolicy =
  | NonNullable<ChangeReviewerConfiguration["acceptanceReview"]>
  | ChangeReviewerConfiguration["specialistReviews"][number];

export const validateChangeReviewerConfigurationResources = (
  configuration: ChangeReviewerConfiguration,
  repositoryRoot: string,
): { readonly ok: true } | { readonly ok: false; readonly message: string } => {
  const policies = [
    ...(configuration.acceptanceReview === null ? [] : [configuration.acceptanceReview]),
    ...configuration.specialistReviews,
  ];
  for (const policy of policies) {
    if (policy.profile.scope === "repo") {
      const resources = [
        ...(policy.profile.profile.runtimeConfig?.extensions ?? []),
        ...(policy.profile.profile.runtimeConfig?.skills ?? []),
      ];
      const unsupported = resources.find((source) => !isPackageAgentResource(source));
      if (unsupported !== undefined) {
        return {
          ok: false,
          message: `Agent Profile "${policy.profile.agentProfile}" in repo scope uses unsupported repository-relative Validation resource "${unsupported}".`,
        };
      }
    }
    const result = validatePiAgentProfileResources(policy.profile, repositoryRoot);
    if (!result.ok) return { ok: false, message: result.error.message };
  }
  return { ok: true };
};

export const sameChangeReviewerPolicy = (
  producer: string,
  left: ChangeReviewerPolicy,
  right: ChangeReviewerPolicy,
): boolean => reviewerPolicyValue(producer, left) === reviewerPolicyValue(producer, right);

const reviewerPolicyValue = (producer: string, policy: ChangeReviewerPolicy): string =>
  producer === "acceptance"
    ? encodeSqliteChangeReviewerConfiguration({
        acceptanceReview: policy as NonNullable<ChangeReviewerConfiguration["acceptanceReview"]>,
        specialistReviews: [],
      })
    : encodeSqliteChangeReviewerConfiguration({
        acceptanceReview: null,
        specialistReviews: [policy as ChangeReviewerConfiguration["specialistReviews"][number]],
      });
