import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Effect } from "effect";
import { runDisposableExactCommitWorkspace } from "../../disposableWorkspace/adapters/runDisposableExactCommitWorkspace.js";
import { readGlobalConfig } from "../../init/adapters/globalConfig.js";
import { readRepoConfig } from "../../init/adapters/repoConfig.js";
import { resolveAcceptanceReviewPolicy } from "../acceptanceReview/acceptanceReviewConfig.js";
import { validateChangeReviewerConfigurationResources } from "../changeReviewerConfiguration.js";
import type { ChangeReviewerConfiguration } from "../changeStartStore.js";
import { resolveSpecialistReviewPolicies } from "../specialistReview/specialistReviewConfig.js";

export type ChangeReviewerConfigurationResolution =
  | { readonly ok: true; readonly configuration: ChangeReviewerConfiguration }
  | { readonly ok: false; readonly message: string };

const resolveChangeReviewerConfiguration = (
  repoConfig: Parameters<typeof resolveSpecialistReviewPolicies>[0]["repoConfig"] | undefined,
  globalConfigPath: string,
  repoRoot: string,
  acceptanceContextSupplied: boolean,
): ChangeReviewerConfigurationResolution => {
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
  const configuration: ChangeReviewerConfiguration = {
    acceptanceReview: acceptance.policy === null ? null : snapshotReviewerPolicy(acceptance.policy),
    specialistReviews: specialists.policies.map(snapshotReviewerPolicy),
  };
  const resources = validateChangeReviewerConfigurationResources(configuration, repoRoot);
  return resources.ok ? { ok: true, configuration } : resources;
};

export const resolveChangeReviewerConfigurationAtCommit = (input: {
  readonly repoRoot: string;
  readonly workspaceContainerRoot: string;
  readonly commit: string;
  readonly globalConfigPath: string;
  readonly acceptanceContextSupplied: boolean;
  readonly expectedIdPrefix: string;
}): Effect.Effect<ChangeReviewerConfigurationResolution> =>
  Effect.gen(function* () {
    const result = yield* runDisposableExactCommitWorkspace({
      repoRoot: input.repoRoot,
      workspaceId: `change-start-${randomUUID()}`,
      workspaceContainerRoot: input.workspaceContainerRoot,
      commitSha: input.commit,
      copyFiles: [],
      runInWorkspace: ({ worktreePath }) =>
        Effect.sync(() => {
          const config = readRepoConfig(join(worktreePath, ".but-why", "config.json"));
          if (!config.ok) return { ok: false as const, message: config.error.message };
          if (config.config.idPrefix !== input.expectedIdPrefix) {
            return {
              ok: false as const,
              message: "Change Base Repo Config idPrefix does not match Shared Repository State.",
            };
          }
          return resolveChangeReviewerConfiguration(
            config.config,
            input.globalConfigPath,
            worktreePath,
            input.acceptanceContextSupplied,
          );
        }),
    });
    if (!result.ok) {
      return {
        ok: false,
        message: `Change Base reviewer resources could not be inspected: ${result.toolingError.errorMessage}`,
      };
    }
    return (
      result.workspaceResult ?? {
        ok: false,
        message: "Change Base reviewer configuration was not resolved.",
      }
    );
  });

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
