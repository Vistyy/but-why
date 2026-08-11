import { repoAgentEnvironment } from "../../agent/agentEnvironment.js";
import { validatePiAgentProfileResources } from "../../agent/piRuntime.js";
import {
  type GlobalConfigValidationFailed,
  RepoConfigValidationFailed,
} from "../../contracts/configErrors.js";
import type { RepoConfig } from "../../contracts/repoConfig.js";
import { readGlobalConfig } from "../../init/globalConfig.js";
import type { LocalRepositoryContext } from "../../repositoryRuntime/repositoryContext.js";
import { resolveAcceptanceReviewPolicy } from "../acceptanceReview/acceptanceReviewConfig.js";
import { resolveSpecialistReviewPolicies } from "../specialistReview/specialistReviewConfig.js";
import type { SubmitRejectionError } from "../submit/submitRejectionErrors.js";
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
  readonly acceptanceContextSupplied: boolean;
  readonly repoConfig?: RepoConfig;
  readonly validationRepoConfig?: RepoConfig;
  readonly repoRoot?: string;
}): CandidateValidationPolicyResolution => {
  const global = readGlobalConfig(input.globalConfigPath);
  if (!global.ok) return global;

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
  const specialistReviews = resolveSpecialistReviewPolicies({
    repoConfig,
    globalConfig: global.config,
    repoRoot,
    globalConfigPath: input.globalConfigPath,
  });
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
    copyFiles: validationRepoConfig.validationWorkspace?.copyFiles ?? [],
    specialistReviews: specialistReviews.policies,
  };
  if (!input.acceptanceContextSupplied)
    return { ok: true, resolved: { acceptanceContextSupplied: false, policy } };

  const acceptanceReview = resolveAcceptanceReviewPolicy({
    repoConfig,
    globalConfig: global.config,
    repoRoot,
    globalConfigPath: input.globalConfigPath,
  });
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
