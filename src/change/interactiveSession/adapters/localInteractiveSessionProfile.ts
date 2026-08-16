import { dirname } from "node:path";

import { resolveInteractiveSessionAgentProfile } from "../../../agent/agentProfiles.js";
import { validatePiAgentProfileResources } from "../../../agent/piRuntime.js";
import { readGlobalConfig } from "../../../init/adapters/globalConfig.js";
import type { InteractiveSessionProfileLoader } from "../interactiveSessionProfile.js";

export const loadLocalInteractiveSessionProfile: InteractiveSessionProfileLoader = (
  repoConfig,
  worktreePath,
  globalConfigPath,
) => {
  const globalConfig = readGlobalConfig(globalConfigPath);
  if (!globalConfig.ok) {
    return {
      ok: false,
      code: "agent_profile_invalid",
      message: `Global Config is invalid: ${globalConfig.error.message}`,
    };
  }
  const agentProfile = resolveInteractiveSessionAgentProfile({
    repoConfig,
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
