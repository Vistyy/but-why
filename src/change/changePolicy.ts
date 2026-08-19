import { Schema } from "effect";
import type { AgentEnvironmentCommand } from "../agent/agentEnvironment.js";
import { nonBlankStringSchema } from "../contracts/agentConfig.js";
import { checkIdSchema, timeoutSecondsSchema } from "../contracts/repoConfig.js";
import type { AcceptanceReviewPolicy } from "./acceptanceReview/acceptanceReviewConfig.js";
import type { ChangePrepareDefinition } from "./change.js";
import {
  decodeChangeReviewerConfiguration,
  encodeSqliteChangeReviewerConfiguration,
} from "./changeReviewerConfiguration.js";
import type { SpecialistReviewPolicy } from "./specialistReview/specialistReviewConfig.js";
import type { SubmitCheckConfig } from "./submit/submitRepoConfig.js";

export type ChangeReviewerConfiguration = {
  readonly acceptanceReview: AcceptanceReviewPolicy | null;
  readonly specialistReviews: readonly SpecialistReviewPolicy[];
  readonly agentEnvironment?: AgentEnvironmentCommand;
};

export type ChangeChecks = readonly [SubmitCheckConfig, ...SubmitCheckConfig[]];

export type ChangePolicy = {
  readonly reviewerConfiguration: ChangeReviewerConfiguration;
  readonly prepare: ChangePrepareDefinition | null;
  readonly checks: ChangeChecks;
};

const changePrepareSchema = Schema.Struct({
  command: nonBlankStringSchema,
  timeoutSeconds: timeoutSecondsSchema,
});

const changeChecksSchema = Schema.NonEmptyArray(
  Schema.Struct({
    id: checkIdSchema,
    command: nonBlankStringSchema,
    timeoutSeconds: timeoutSecondsSchema,
  }),
).pipe(
  Schema.filter((checks) => new Set(checks.map((check) => check.id)).size === checks.length, {
    message: () => "Validation Check IDs must be unique",
  }),
);

const changePolicySchema = Schema.Struct({
  reviewerConfiguration: Schema.Unknown,
  prepare: Schema.NullOr(changePrepareSchema),
  checks: changeChecksSchema,
});

const decodePolicyShape = Schema.decodeUnknownSync(changePolicySchema, {
  onExcessProperty: "error",
});

const decodeChangePolicy = (value: unknown): ChangePolicy => {
  const policy = decodePolicyShape(value);
  return {
    reviewerConfiguration: decodeChangeReviewerConfiguration(policy.reviewerConfiguration),
    prepare: policy.prepare,
    checks: policy.checks,
  };
};

export const encodeSqliteChangePolicy = (policy: ChangePolicy) => {
  const decoded = decodeChangePolicy(policy);
  return {
    reviewerConfiguration: encodeSqliteChangeReviewerConfiguration(decoded.reviewerConfiguration),
    prepareDefinition: decoded.prepare === null ? null : JSON.stringify(decoded.prepare),
    checksDefinition: JSON.stringify(decoded.checks),
  };
};

export const decodeSqliteChangePolicy = (source: {
  readonly reviewerConfiguration: string;
  readonly prepareDefinition: string | null;
  readonly checksDefinition: string;
}): ChangePolicy =>
  decodeChangePolicy({
    reviewerConfiguration: JSON.parse(source.reviewerConfiguration) as unknown,
    prepare:
      source.prepareDefinition === null ? null : (JSON.parse(source.prepareDefinition) as unknown),
    checks: JSON.parse(source.checksDefinition) as unknown,
  });
