import { Effect } from "effect";
import { repoAgentEnvironment } from "../../agent/agentEnvironment.js";
import type { ResolvedReviewerPiAgentProfile } from "../../agent/agentProfiles.js";
import { readGlobalConfig } from "../../init/adapters/globalConfig.js";
import { decodeRepoConfigSource } from "../../init/adapters/repoConfig.js";
import { readRepositoryFileAtCommit } from "../../submissionEnvironment/adapters/repositoryFile.js";
import { resolveAcceptanceReviewPolicy } from "../acceptanceReview/acceptanceReviewConfig.js";
import type { ChangePolicy } from "../changePolicy.js";
import { validateChangeReviewerConfigurationResources } from "../changeReviewerConfiguration.js";
import { resolveSpecialistReviewPolicies } from "../specialistReview/specialistReviewConfig.js";
import { submitRepoConfig } from "../submit/submitRepoConfig.js";

export type ChangePolicyResolution =
  | { readonly ok: true; readonly policy: ChangePolicy }
  | { readonly ok: false; readonly message: string };

const snapshotProfile = (
  profile: ResolvedReviewerPiAgentProfile,
): ResolvedReviewerPiAgentProfile => ({
  agentProfile: profile.agentProfile,
  scope: profile.scope,
  profile: profile.profile,
  ...(profile.globalConfigDirectory === undefined
    ? {}
    : { globalConfigDirectory: profile.globalConfigDirectory }),
});

export const resolveChangePolicyAtCommit = (input: {
  readonly repositoryRoot: string;
  readonly commit: string;
  readonly globalConfigPath: string;
  readonly acceptanceContextSupplied: boolean;
  readonly expectedIdPrefix: string;
}): Effect.Effect<ChangePolicyResolution> =>
  Effect.sync(() => {
    const source = readRepositoryFileAtCommit(
      input.repositoryRoot,
      input.commit,
      ".but-why/config.json",
    );
    if (!source.ok) {
      return {
        ok: false,
        message: `Repo Config is missing at Change Base ${input.commit}.`,
      };
    }
    const decoded = decodeRepoConfigSource(source.content);
    if (!decoded.ok) return { ok: false, message: decoded.error.message };
    if (decoded.config.idPrefix !== input.expectedIdPrefix) {
      return {
        ok: false,
        message: "Change Base Repo Config idPrefix does not match Shared Repository State.",
      };
    }
    const global = readGlobalConfig(input.globalConfigPath);
    if (!global.ok) return { ok: false, message: global.error.message };
    const submit = submitRepoConfig(decoded.config);
    if (!submit.ok) return { ok: false, message: submit.error.message };
    const readRepoInstructions = (path: string) => {
      const read = readRepositoryFileAtCommit(input.repositoryRoot, input.commit, path);
      return read.ok
        ? { ok: true as const, content: read.content }
        : {
            ok: false as const,
            message: `Could not read reviewer instructions ${path} from Change Base ${input.commit}.`,
          };
    };
    const specialist = resolveSpecialistReviewPolicies({
      repoConfig: decoded.config,
      globalConfig: global.config,
      repoRoot: input.repositoryRoot,
      globalConfigPath: input.globalConfigPath,
      readRepoInstructions,
    });
    if (!specialist.ok) return { ok: false, message: specialist.error.message };
    const acceptance = input.acceptanceContextSupplied
      ? resolveAcceptanceReviewPolicy({
          repoConfig: decoded.config,
          globalConfig: global.config,
          repoRoot: input.repositoryRoot,
          globalConfigPath: input.globalConfigPath,
          readRepoInstructions,
        })
      : { ok: true as const, policy: null };
    if (!acceptance.ok) return { ok: false, message: acceptance.error.message };
    const agentEnvironment = repoAgentEnvironment(decoded.config);
    const reviewerConfiguration = {
      acceptanceReview:
        acceptance.policy === null
          ? null
          : {
              ...acceptance.policy,
              profile: snapshotProfile(acceptance.policy.profile),
            },
      specialistReviews: specialist.policies.map((policy) => ({
        ...policy,
        profile: snapshotProfile(policy.profile),
      })),
      ...(agentEnvironment === undefined ? {} : { agentEnvironment }),
    };
    const resources = validateChangeReviewerConfigurationResources(
      reviewerConfiguration,
      input.repositoryRoot,
    );
    if (!resources.ok) return resources;
    return {
      ok: true,
      policy: {
        reviewerConfiguration,
        prepare: submit.config.prepare ?? null,
        checks: submit.config.checks,
      },
    };
  });
