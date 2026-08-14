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
import type {
  AcceptanceContextCandidateValidationPolicy,
  CandidateValidationPolicy,
} from "./validateCandidate.js";

export type ResolvedCandidateValidationPolicy =
  | { readonly acceptanceContextSupplied: false; readonly policy: CandidateValidationPolicy }
  | {
      readonly acceptanceContextSupplied: true;
      readonly policy: AcceptanceContextCandidateValidationPolicy;
    };

export type CandidateValidationPolicyResolution =
  | { readonly ok: true; readonly resolved: ResolvedCandidateValidationPolicy }
  | {
      readonly ok: false;
      readonly error: SubmitRejectionError | GlobalConfigValidationFailed;
    };

export const resolveCandidateValidationPolicy = (input: {
  readonly context:
    | LocalRepositoryContext
    | { readonly root: string; readonly config?: RepoConfig };
  readonly globalConfigPath: string;
  readonly globalConfig: GlobalConfig;
  readonly acceptanceContextSupplied: boolean;
  readonly repoConfig?: RepoConfig;
  readonly validationRepoConfig?: RepoConfig;
  readonly repoRoot?: string;
  readonly reviewerConfiguration?: ChangeReviewerConfiguration;
}): CandidateValidationPolicyResolution => {
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
  const validationRepoConfig = input.validationRepoConfig ?? repoConfig;
  const submit = submitRepoConfig(validationRepoConfig);
  if (!submit.ok) return submit;
  const specialistReviews =
    input.reviewerConfiguration === undefined
      ? resolveSpecialistReviewPolicies({
          repoConfig,
          globalConfig: input.globalConfig,
          repoRoot,
          globalConfigPath: input.globalConfigPath,
        })
      : { ok: true as const, policies: input.reviewerConfiguration.specialistReviews };
  if (!specialistReviews.ok) return specialistReviews;

  for (const specialist of specialistReviews.policies) {
    const resources = validatePiAgentProfileResources(specialist.profile, repoRoot);
    if (!resources.ok) return resources;
  }

  const agentEnvironment = repoAgentEnvironment(validationRepoConfig);
  const policy: CandidateValidationPolicy = {
    ...(agentEnvironment === undefined ? {} : { agentEnvironment }),
    ...(submit.config.prepare === undefined ? {} : { prepare: submit.config.prepare }),
    checks: submit.config.checks,
    copyFiles: validationRepoConfig.snapshotWorkspace?.copyFiles ?? [],
    specialistReviews: specialistReviews.policies,
  };
  if (!input.acceptanceContextSupplied)
    return { ok: true, resolved: { acceptanceContextSupplied: false, policy } };

  const acceptanceReview =
    input.reviewerConfiguration === undefined
      ? resolveAcceptanceReviewPolicy({
          repoConfig,
          globalConfig: input.globalConfig,
          repoRoot,
          globalConfigPath: input.globalConfigPath,
        })
      : input.reviewerConfiguration.acceptanceReview === null
        ? {
            ok: false as const,
            error: new InvalidReviewerConfig({
              message: "The stored Change reviewer configuration has no Acceptance Reviewer.",
            }),
          }
        : { ok: true as const, policy: input.reviewerConfiguration.acceptanceReview };
  if (!acceptanceReview.ok) return acceptanceReview;
  const acceptanceResources = validatePiAgentProfileResources(
    acceptanceReview.policy.profile,
    repoRoot,
  );
  if (!acceptanceResources.ok) return acceptanceResources;
  return {
    ok: true,
    resolved: {
      acceptanceContextSupplied: true,
      policy: { ...policy, acceptanceReview: acceptanceReview.policy },
    },
  };
};
