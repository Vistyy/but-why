import { dirname, join } from "node:path";

import { resolveInteractiveSessionAgentProfile } from "../../agent/agentProfiles.js";
import { validatePiAgentProfileResources } from "../../agent/piRuntime.js";
import { readGlobalConfig } from "../../init/globalConfig.js";
import { readRepoConfig } from "../../init/repoConfig.js";

export type InteractiveSessionProfileLoadResult =
  | {
      readonly ok: true;
      readonly profile: NonNullable<
        Extract<
          ReturnType<typeof resolveInteractiveSessionAgentProfile>,
          { readonly ok: true }
        >["profile"]
      >;
      readonly globalConfigDirectory: string;
    }
  | {
      readonly ok: false;
      readonly code: "repo_config_invalid" | "agent_profile_invalid";
      readonly message: string;
    };

export type InteractiveSessionProfileLoader = (
  worktreePath: string,
  globalConfigPath: string,
) => InteractiveSessionProfileLoadResult;

export const loadLocalInteractiveSessionProfile: InteractiveSessionProfileLoader = (
  worktreePath,
  globalConfigPath,
) => {
  const managedRepoConfig = readRepoConfig(join(worktreePath, ".but-why", "config.json"));
  if (!managedRepoConfig.ok) {
    return {
      ok: false,
      code: "repo_config_invalid",
      message: `Managed Worktree Repo Config is invalid: ${managedRepoConfig.error.message}`,
    };
  }
  const globalConfig = readGlobalConfig(globalConfigPath);
  if (!globalConfig.ok) {
    return {
      ok: false,
      code: "agent_profile_invalid",
      message: `Global Config is invalid: ${globalConfig.error.message}`,
    };
  }
  const agentProfile = resolveInteractiveSessionAgentProfile({
    repoConfig: managedRepoConfig.config,
    globalConfig: globalConfig.config,
    globalConfigDirectory: dirname(globalConfigPath),
  });
  if (!agentProfile.ok) {
    return {
      ok: false,
      code: "agent_profile_invalid",
      message: agentProfileErrorMessage(agentProfile.error),
    };
  }
  if (agentProfile.profile === undefined) {
    return {
      ok: false,
      code: "agent_profile_invalid",
      message: "Interactive Session Agent Profile is not configured.",
    };
  }
  const resources = validatePiAgentProfileResources(agentProfile.profile, worktreePath);
  if (!resources.ok) {
    return { ok: false, code: "agent_profile_invalid", message: resources.error.message };
  }
  return {
    ok: true,
    profile: agentProfile.profile,
    globalConfigDirectory: dirname(globalConfigPath),
  };
};

const agentProfileErrorMessage = (error: {
  readonly _tag: string;
  readonly profileName?: string;
  readonly scope?: "repo" | "global";
  readonly agentRuntime?: string;
}): string => {
  const profile = `Interactive Session Agent Profile "${error.profileName ?? "<missing>"}"`;
  const scope = error.scope === undefined ? "" : ` in ${error.scope} scope`;
  if (error._tag === "MissingAgentProfile") return `${profile}${scope} was not found.`;
  if (error._tag === "MissingAgentModel") {
    return `${profile}${scope} has no Pi model in runtimeConfig.`;
  }
  return `${profile}${scope} must use the Pi agent runtime; it uses "${error.agentRuntime ?? "unknown"}".`;
};
