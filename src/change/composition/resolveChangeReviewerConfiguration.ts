import { readGlobalConfig } from "../../init/adapters/globalConfig.js";
import { resolveAcceptanceReviewPolicy } from "../acceptanceReview/acceptanceReviewConfig.js";
import type { ChangeReviewerConfiguration } from "../changeStartStore.js";
import { resolveSpecialistReviewPolicies } from "../specialistReview/specialistReviewConfig.js";

export const resolveChangeReviewerConfiguration = (
  repoConfig: Parameters<typeof resolveSpecialistReviewPolicies>[0]["repoConfig"] | undefined,
  globalConfigPath: string,
  repoRoot: string,
  acceptanceContextSupplied: boolean,
):
  | { readonly ok: true; readonly configuration: ChangeReviewerConfiguration }
  | { readonly ok: false; readonly message: string } => {
  if (repoConfig === undefined) {
    return {
      ok: false,
      message: "Repo Config is required to resolve Change reviewer configuration.",
    };
  }
  const globalConfig = readGlobalConfig(globalConfigPath);
  if (!globalConfig.ok) return { ok: false, message: globalConfig.error.message };
  const specialists = resolveSpecialistReviewPolicies({
    repoConfig,
    globalConfig: globalConfig.config,
    repoRoot,
    globalConfigPath,
  });
  if (!specialists.ok) return { ok: false, message: specialists.error.message };
  const acceptance = acceptanceContextSupplied
    ? resolveAcceptanceReviewPolicy({
        repoConfig,
        globalConfig: globalConfig.config,
        repoRoot,
        globalConfigPath,
      })
    : { ok: true as const, policy: null };
  if (!acceptance.ok) return { ok: false, message: acceptance.error.message };
  return {
    ok: true,
    configuration: {
      acceptanceReview:
        acceptance.policy === null ? null : snapshotReviewerPolicy(acceptance.policy),
      specialistReviews: specialists.policies.map(snapshotReviewerPolicy),
    },
  };
};

const snapshotReviewerPolicy = <
  Policy extends { readonly profile: { readonly globalConfigDirectory?: string } },
>(
  policy: Policy,
): Policy => ({
  ...policy,
  profile: {
    ...policy.profile,
    ...(policy.profile.globalConfigDirectory === undefined
      ? {}
      : { globalConfigDirectory: policy.profile.globalConfigDirectory }),
  },
});
