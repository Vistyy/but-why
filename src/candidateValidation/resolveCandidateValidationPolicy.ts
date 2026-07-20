import type { GlobalConfigValidationFailed } from "../contracts/configErrors.js";
import { readGlobalConfig } from "../init/globalConfig.js";
import type { RepoLocalContext } from "../init/repoContext.js";
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
}): CandidateValidationPolicyResolution => {
  const global = readGlobalConfig(input.globalConfigPath);
  if (!global.ok) return global;

  const submit = submitRepoConfig(input.context.config, global.config);
  if (!submit.ok) return submit;
  const specialistReviews = resolveSpecialistReviewPolicies({
    repoConfig: input.context.config,
    globalConfig: global.config,
    repoRoot: input.context.root,
    globalConfigPath: input.globalConfigPath,
  });
  if (!specialistReviews.ok) return specialistReviews;

  const policy: CandidateValidationPolicy = {
    sandboxMode: submit.config.sandboxMode,
    ...(submit.config.prepare === undefined ? {} : { prepare: submit.config.prepare }),
    checks: submit.config.checks,
    copyFiles: input.context.config.validationWorkspace?.copyFiles ?? [],
    specialistReviews: specialistReviews.policies,
  };
  if (!input.taskBacked) return { ok: true, resolved: { taskBacked: false, policy } };

  const acceptanceReview = resolveAcceptanceReviewPolicy({
    repoConfig: input.context.config,
    globalConfig: global.config,
    repoRoot: input.context.root,
    globalConfigPath: input.globalConfigPath,
  });
  return acceptanceReview.ok
    ? {
        ok: true,
        resolved: {
          taskBacked: true,
          policy: { ...policy, acceptanceReview: acceptanceReview.policy },
        },
      }
    : acceptanceReview;
};
