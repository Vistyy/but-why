import { resolveAgentProfile } from "../agent/agentProfiles.js";
import type { AgentProfileConfig } from "../contracts/agentConfig.js";
import type { GlobalConfig } from "../contracts/globalConfig.js";
import type {
  RepoCheckConfig,
  RepoConfig,
  RepoPrepareConfig,
  ReviewerConfig,
} from "../contracts/repoConfig.js";
import type { ValidationSandboxMode } from "../validation/validationWorkspace.js";
import {
  InvalidReviewerConfig,
  RepoConfigValidationFailed,
  type SubmitRejectionError,
} from "./submitRejectionErrors.js";

export type SubmitRepoConfig = {
  readonly sandboxMode: ValidationSandboxMode;
  readonly prepare?: SubmitPrepareConfig;
  readonly checks: readonly SubmitCheckConfig[];
  readonly intentReviewer?: SubmitReviewerConfig;
  readonly specialistReview?: {
    readonly mode: "sequential" | "parallel";
    readonly reviewers: readonly SubmitReviewerConfig[];
  };
};

export type SubmitReviewerConfig = AgentProfileConfig & {
  readonly id: string;
  readonly instructionsFile: string;
};

export type SubmitPrepareConfig = RepoPrepareConfig & {
  readonly timeoutSeconds: number;
};

export type SubmitCheckConfig = RepoCheckConfig & {
  readonly timeoutSeconds: number;
};

const defaultValidationCommandTimeoutSeconds = 1200;

export const submitRepoConfig = (
  config: RepoConfig,
  globalConfig: GlobalConfig,
):
  | { readonly ok: true; readonly config: SubmitRepoConfig }
  | { readonly ok: false; readonly error: SubmitRejectionError } => {
  const configuredChecks = config.validation?.checks;

  if (configuredChecks === undefined || configuredChecks.length === 0) {
    return invalidConfig("Repo config must define at least one validation.checks entry.");
  }

  const seenCheckIds = new Set<string>();
  const checks: SubmitCheckConfig[] = [];

  for (const check of configuredChecks) {
    if (seenCheckIds.has(check.id)) {
      return invalidConfig(`Duplicate check id: ${check.id}`);
    }

    seenCheckIds.add(check.id);
    checks.push({
      id: check.id,
      command: check.command,
      timeoutSeconds: check.timeoutSeconds ?? defaultValidationCommandTimeoutSeconds,
    });
  }

  const reviewers = resolveSelectedReviewers(config, globalConfig);

  if (!reviewers.ok) {
    return reviewers;
  }

  const prepare = config.prepare;

  return {
    ok: true,
    config: {
      sandboxMode: config.validation?.sandbox?.mode ?? "none",
      ...(prepare === undefined
        ? {}
        : {
            prepare: {
              command: prepare.command,
              timeoutSeconds: prepare.timeoutSeconds ?? defaultValidationCommandTimeoutSeconds,
            },
          }),
      checks,
      ...(reviewers.intentReviewer === undefined
        ? {}
        : { intentReviewer: reviewers.intentReviewer }),
      ...(reviewers.specialistReview === undefined
        ? {}
        : { specialistReview: reviewers.specialistReview }),
    },
  };
};

type ResolvedReviewers = {
  readonly intentReviewer?: SubmitReviewerConfig;
  readonly specialistReview?: {
    readonly mode: "sequential" | "parallel";
    readonly reviewers: readonly SubmitReviewerConfig[];
  };
};

const resolveSelectedReviewers = (
  config: RepoConfig,
  globalConfig: GlobalConfig,
):
  | ({ readonly ok: true } & ResolvedReviewers)
  | { readonly ok: false; readonly error: SubmitRejectionError } => {
  const intentReviewerId = config.review?.intent?.reviewer;
  const intentReviewer =
    intentReviewerId === undefined
      ? undefined
      : resolveReviewer(intentReviewerId, config, globalConfig);

  if (intentReviewer !== undefined && !intentReviewer.ok) {
    return intentReviewer;
  }

  const quality = config.review?.quality;
  const specialistReviewers: SubmitReviewerConfig[] = [];

  if (quality !== undefined) {
    for (const reviewerId of quality.reviewers) {
      const reviewer = resolveReviewer(reviewerId, config, globalConfig);

      if (!reviewer.ok) {
        return reviewer;
      }

      specialistReviewers.push(reviewer.reviewer);
    }
  }

  return {
    ok: true,
    ...(intentReviewer === undefined ? {} : { intentReviewer: intentReviewer.reviewer }),
    ...(quality === undefined
      ? {}
      : { specialistReview: { mode: quality.mode, reviewers: specialistReviewers } }),
  };
};

const resolveReviewer = (
  reviewerId: string,
  config: RepoConfig,
  globalConfig: GlobalConfig,
):
  | { readonly ok: true; readonly reviewer: SubmitReviewerConfig }
  | { readonly ok: false; readonly error: SubmitRejectionError } => {
  const reviewer: ReviewerConfig | undefined = config.reviewers?.[reviewerId];

  if (reviewer === undefined) {
    return {
      ok: false,
      error: new InvalidReviewerConfig({
        message: `Selected reviewer is not defined: ${reviewerId}`,
      }),
    };
  }

  const resolution = resolveAgentProfile({
    ...(reviewer.agentProfile === undefined ? {} : { agentProfile: reviewer.agentProfile }),
    ...(config.agentProfiles === undefined ? {} : { repoProfiles: config.agentProfiles }),
    globalConfig,
  });

  if (!resolution.ok) {
    return resolution;
  }

  return {
    ok: true,
    reviewer: {
      id: reviewerId,
      instructionsFile: reviewer.instructionsFile,
      ...resolution.resolved.profile,
    },
  };
};

const invalidConfig = (
  message: string,
): { readonly ok: false; readonly error: SubmitRejectionError } => ({
  ok: false,
  error: new RepoConfigValidationFailed({
    path: ".but-why/config.json",
    diagnostics: [],
    message,
  }),
});
