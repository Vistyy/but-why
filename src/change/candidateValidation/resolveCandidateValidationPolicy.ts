import type { GlobalConfigValidationFailed } from "../../contracts/configErrors.js";
import { validatePiAgentProfileResources } from "../../agent/piRuntime.js";
import type { RepoConfig } from "../../contracts/repoConfig.js";
import { readGlobalConfig } from "../../init/globalConfig.js";
import type { RepoLocalContext } from "../../init/repoContext.js";
import { resolveAcceptanceReviewPolicy } from "../acceptanceReview/acceptanceReviewConfig.js";
import { resolveSpecialistReviewPolicies } from "../specialistReview/specialistReviewConfig.js";
import { submitRepoConfig } from "../submit/submitRepoConfig.js";
import type { SubmitRejectionError } from "../submit/submitRejectionErrors.js";
import type {
  CandidateValidationPolicy,
  TaskBackedCandidateValidationPolicy,
} from "./validateCandidate.js";

export type ResolvedCandidateValidationPolicy =
  | { readonly taskBacked: false; readonly policy: CandidateValidationPolicy }
  | { readonly taskBacked: true; readonly policy: TaskBackedCandidateValidationPolicy };

export type CandidateValidationPolicyResolution =
  | { readonly ok: true; readonly resolved: ResolvedCandidateValidationPolicy }
  | {
      readonly ok: false;
      readonly error: SubmitRejectionError | GlobalConfigValidationFailed;
    };

export const resolveCandidateValidationPolicy = (input: {
  readonly context: RepoLocalContext;
  readonly globalConfigPath: string;
  readonly taskBacked: boolean;
  readonly repoConfig?: RepoConfig;
  readonly repoRoot?: string;
}): CandidateValidationPolicyResolution => {
  const global = readGlobalConfig(input.globalConfigPath);
  if (!global.ok) return global;

  const repoConfig = input.repoConfig ?? input.context.config;
  const repoRoot = input.repoRoot ?? input.context.root;
  const submit = submitRepoConfig(repoConfig);
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

  const policy: CandidateValidationPolicy = {
    ...(submit.config.prepare === undefined ? {} : { prepare: submit.config.prepare }),
    checks: submit.config.checks,
    copyFiles: repoConfig.validationWorkspace?.copyFiles ?? [],
    specialistReviews: specialistReviews.policies,
  };
  if (!input.taskBacked) return { ok: true, resolved: { taskBacked: false, policy } };

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
      taskBacked: true,
      policy: { ...policy, acceptanceReview: acceptanceReview.policy },
    },
  };
};
