import { repoAgentEnvironment } from "../../agent/agentEnvironment.js";
import { validatePiAgentProfileResources } from "../../agent/piRuntime.js";
import {
  type GlobalConfigValidationFailed,
  RepoConfigValidationFailed,
} from "../../contracts/configErrors.js";
import type { GlobalConfig } from "../../contracts/globalConfig.js";
import type { RepoConfig } from "../../contracts/repoConfig.js";
import type { LocalRepositoryContext } from "../../repositoryRuntime/repositoryContext.js";
import { resolveAcceptanceReviewPolicy } from "../acceptanceReview/acceptanceReviewConfig.js";
import type { ChangeReviewerConfiguration } from "../changeStartStore.js";
import { resolveSpecialistReviewPolicies } from "../specialistReview/specialistReviewConfig.js";
import type { SubmitRejectionError } from "../submit/submitRejectionErrors.js";
import { InvalidReviewerConfig } from "../submit/submitRejectionErrors.js";
import { submitRepoConfig } from "../submit/submitRepoConfig.js";
import type { CandidateValidationPolicy } from "./validateCandidate.js";

export type ResolvedCandidateValidationPolicy = {
  readonly acceptanceContextSupplied: boolean;
  readonly policy: CandidateValidationPolicy;
  readonly reviewerConfiguration: ChangeReviewerConfiguration;
};

export type CandidateValidationPolicyResolution =
  | { readonly ok: true; readonly resolved: ResolvedCandidateValidationPolicy }
  | {
      readonly ok: false;
      readonly error: SubmitRejectionError | GlobalConfigValidationFailed;
    };

type CandidateValidationPolicyInput = {
  readonly context:
    | LocalRepositoryContext
    | { readonly root: string; readonly config?: RepoConfig };
  readonly globalConfigPath: string;
  readonly acceptanceContextSupplied: boolean;
  readonly repoConfig?: RepoConfig;
  readonly repoRoot?: string;
} & (
  | { readonly globalConfig: GlobalConfig; readonly reviewerConfiguration?: undefined }
  | {
      readonly globalConfig?: GlobalConfig;
      readonly reviewerConfiguration: ChangeReviewerConfiguration;
    }
);

export const resolveCandidateValidationPolicy = (
  input: CandidateValidationPolicyInput,
): CandidateValidationPolicyResolution => {
  const repoConfig = input.repoConfig ?? input.context.config;
  const repoRoot = input.repoRoot ?? input.context.root;
  if (repoConfig === undefined) {
    return {
      ok: false,
      error: new RepoConfigValidationFailed({
        path: ".but-why/config.json",
        diagnostics: [],
        message: "Repo Config is required to resolve the Validation Policy.",
      }),
    };
  }
  const submit = submitRepoConfig(repoConfig);
  if (!submit.ok) return submit;

  const reviewerConfiguration = resolveReviewerConfiguration(input, repoConfig, repoRoot);
  if (!reviewerConfiguration.ok) return reviewerConfiguration;
  for (const specialist of reviewerConfiguration.configuration.specialistReviews) {
    const resources = validatePiAgentProfileResources(specialist.profile, repoRoot);
    if (!resources.ok) return resources;
  }
  const acceptance = reviewerConfiguration.configuration.acceptanceReview;
  if (input.acceptanceContextSupplied && acceptance === null) {
    return {
      ok: false,
      error: new InvalidReviewerConfig({
        message: "The stored Change reviewer configuration has no Acceptance Reviewer.",
      }),
    };
  }
  if (acceptance !== null) {
    const resources = validatePiAgentProfileResources(acceptance.profile, repoRoot);
    if (!resources.ok) return resources;
  }

  const agentEnvironment = repoAgentEnvironment(repoConfig);
  const policy: CandidateValidationPolicy = {
    ...(agentEnvironment === undefined ? {} : { agentEnvironment }),
    ...(submit.config.prepare === undefined ? {} : { prepare: submit.config.prepare }),
    checks: submit.config.checks,
    copyFiles: repoConfig.snapshotWorkspace?.copyFiles ?? [],
  };
  return {
    ok: true,
    resolved: {
      acceptanceContextSupplied: input.acceptanceContextSupplied,
      policy,
      reviewerConfiguration: reviewerConfiguration.configuration,
    },
  };
};

const resolveReviewerConfiguration = (
  input: CandidateValidationPolicyInput,
  repoConfig: RepoConfig,
  repoRoot: string,
):
  | { readonly ok: true; readonly configuration: ChangeReviewerConfiguration }
  | { readonly ok: false; readonly error: SubmitRejectionError | GlobalConfigValidationFailed } => {
  if (input.reviewerConfiguration !== undefined) {
    return { ok: true, configuration: input.reviewerConfiguration };
  }
  const specialists = resolveSpecialistReviewPolicies({
    repoConfig,
    globalConfig: input.globalConfig,
    repoRoot,
    globalConfigPath: input.globalConfigPath,
  });
  if (!specialists.ok) return specialists;
  if (!input.acceptanceContextSupplied) {
    return {
      ok: true,
      configuration: { acceptanceReview: null, specialistReviews: specialists.policies },
    };
  }
  const acceptance = resolveAcceptanceReviewPolicy({
    repoConfig,
    globalConfig: input.globalConfig,
    repoRoot,
    globalConfigPath: input.globalConfigPath,
  });
  if (!acceptance.ok) return acceptance;
  return {
    ok: true,
    configuration: {
      acceptanceReview: acceptance.policy,
      specialistReviews: specialists.policies,
    },
  };
};
