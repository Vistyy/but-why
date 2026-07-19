import type { AgentProfileConfig, PiAgentProfileConfig } from "../contracts/agentConfig.js";
import type { GlobalConfig } from "../contracts/globalConfig.js";
import {
  MissingAgentModel,
  MissingAgentProfile,
  UnsupportedAgentRuntime,
  type AgentProfileResolutionError,
} from "./agentProfileErrors.js";
import { agentRuntimeAdapters, isSupportedAgentRuntime } from "./runtimeAdapters.js";

export type ResolvedPiAgentProfile = Omit<PiAgentProfileConfig, "agentModel" | "thinking"> & {
  readonly agentModel: string;
  readonly thinking?: Exclude<PiAgentProfileConfig["thinking"], undefined>;
};

export type ResolvedAgentProfile = {
  readonly agentProfile: string;
  readonly source: "repo" | "global";
  readonly profile: AgentProfileConfig;
};

export const resolveAgentProfile = (input: {
  readonly agentProfile?: string;
  readonly repoProfiles?: Readonly<Record<string, AgentProfileConfig>>;
  readonly globalConfig: GlobalConfig;
}):
  | { readonly ok: true; readonly resolved: ResolvedAgentProfile }
  | { readonly ok: false; readonly error: AgentProfileResolutionError } => {
  const profileName = input.agentProfile ?? input.globalConfig.defaultAgentProfile;

  if (profileName === undefined) {
    return { ok: false, error: new MissingAgentProfile({ selection: "default" }) };
  }

  const explicit = input.agentProfile !== undefined;
  const repoProfile = explicit ? input.repoProfiles?.[profileName] : undefined;
  const profile = repoProfile ?? input.globalConfig.agentProfiles?.[profileName];
  const source = repoProfile === undefined ? "global" : "repo";

  if (profile === undefined) {
    return {
      ok: false,
      error: new MissingAgentProfile({
        profileName,
        selection: explicit ? "explicit" : "default",
      }),
    };
  }

  if (!isSupportedAgentRuntime(profile.agentRuntime)) {
    return {
      ok: false,
      error: new UnsupportedAgentRuntime({ profileName, agentRuntime: profile.agentRuntime }),
    };
  }

  if (
    profile.agentModel === undefined &&
    !agentRuntimeAdapters[profile.agentRuntime].supportsHarnessDefaultModel
  ) {
    return {
      ok: false,
      error: new MissingAgentModel({ profileName, agentRuntime: profile.agentRuntime }),
    };
  }

  return { ok: true, resolved: { agentProfile: profileName, source, profile } };
};
