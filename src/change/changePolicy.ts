import { Schema } from "effect";
import type { AgentEnvironmentCommand } from "../agent/agentEnvironment.js";
import { nonBlankStringSchema } from "../contracts/agentConfig.js";
import { checkIdSchema, type RepoConfig, timeoutSecondsSchema } from "../contracts/repoConfig.js";
import type { AcceptanceReviewPolicy } from "./acceptanceReview/acceptanceReviewConfig.js";
import {
  decodeChangeReviewerConfiguration,
  encodeSqliteChangeReviewerConfiguration,
} from "./changeReviewerConfiguration.js";
import type { SpecialistReviewPolicy } from "./specialistReview/specialistReviewConfig.js";
import type { StallDetectorPolicy } from "./stallDetection/stallDetector.js";

export type ChangeReviewerConfiguration = {
  readonly acceptanceReview: AcceptanceReviewPolicy | null;
  readonly specialistReviews: readonly SpecialistReviewPolicy[];
  readonly agentEnvironment?: AgentEnvironmentCommand;
  readonly stallDetector?: StallDetectorPolicy;
};

export type ChangePrepareDefinition = {
  readonly command: string;
  readonly timeoutSeconds: number;
};

export type ChangeCheck = {
  readonly id: string;
  readonly command: string;
  readonly timeoutSeconds: number;
};

export type ChangeChecks = readonly [ChangeCheck, ...ChangeCheck[]];

export type ChangePolicy = {
  readonly reviewerConfiguration: ChangeReviewerConfiguration;
  readonly prepare: ChangePrepareDefinition | null;
  readonly checks: ChangeChecks;
};

export type ChangePolicyResolutionFailure = {
  readonly ok: false;
  readonly code:
    | "reviewer_configuration_invalid"
    | "committed_repo_config_missing"
    | "committed_repo_config_invalid";
  readonly message: string;
};

export type ChangePolicyResolution =
  | { readonly ok: true; readonly policy: ChangePolicy }
  | ChangePolicyResolutionFailure;

type ChangePolicyDefinitions = Pick<ChangePolicy, "prepare" | "checks">;

const defaultCommandTimeoutSeconds = 1200;

export const resolveChangePolicyDefinitions = (
  config: RepoConfig,
):
  | { readonly ok: true; readonly definitions: ChangePolicyDefinitions }
  | { readonly ok: false; readonly message: string } => {
  const configuredChecks = config.validation?.checks;
  if (configuredChecks === undefined || configuredChecks.length === 0) {
    return { ok: false, message: "Repo config must define at least one validation.checks entry." };
  }

  const seenCheckIds = new Set<string>();
  const checks: ChangeCheck[] = [];
  for (const check of configuredChecks) {
    if (seenCheckIds.has(check.id)) {
      return { ok: false, message: `Duplicate check id: ${check.id}` };
    }
    seenCheckIds.add(check.id);
    checks.push({
      id: check.id,
      command: check.command,
      timeoutSeconds: check.timeoutSeconds ?? defaultCommandTimeoutSeconds,
    });
  }

  const prepare = config.prepare;
  return {
    ok: true,
    definitions: {
      prepare:
        prepare === undefined
          ? null
          : {
              command: prepare.command,
              timeoutSeconds: prepare.timeoutSeconds ?? defaultCommandTimeoutSeconds,
            },
      checks: checks as [ChangeCheck, ...ChangeCheck[]],
    },
  };
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
