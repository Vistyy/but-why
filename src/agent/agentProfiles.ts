import type {
  AgentProfileReference,
  PiAgentProfileConfig,
  PiRuntimeConfig,
} from "../contracts/agentConfig.js";
import type { GlobalConfig } from "../contracts/globalConfig.js";
import type { RepoConfig } from "../contracts/repoConfig.js";
import {
  type AgentProfileResolutionError,
  MissingAgentModel,
  MissingAgentProfile,
  UnsupportedAgentRuntime,
} from "./agentProfileErrors.js";

export type ResolvedPiAgentProfile = {
  readonly agentProfile: string;
  readonly scope: "repo" | "global";
  readonly profile: PiAgentProfileConfig;
  readonly globalConfigDirectory?: string;
};

export type InteractiveSessionAgentProfile = ResolvedPiAgentProfile;

export type ResolvedReviewerPiAgentProfile = Omit<ResolvedPiAgentProfile, "profile"> & {
  readonly profile: PiAgentProfileConfig & {
    readonly runtimeConfig: PiRuntimeConfig & { readonly model: string };
  };
};

type ProfileResolutionInput = {
  readonly repoSelection?: AgentProfileReference;
  readonly globalSelection?: AgentProfileReference;
  readonly defaultSelection?: AgentProfileReference;
  readonly repoProfiles?: Readonly<Record<string, PiAgentProfileConfig>>;
  readonly globalProfiles?: Readonly<Record<string, PiAgentProfileConfig>>;
  readonly requireModel?: boolean;
  readonly globalConfigDirectory?: string;
};

export const resolveInteractiveSessionAgentProfile = (input: {
  readonly repoConfig: RepoConfig;
  readonly globalConfig: GlobalConfig;
  readonly globalConfigDirectory?: string;
}):
  | { readonly ok: true; readonly profile: InteractiveSessionAgentProfile | undefined }
  | { readonly ok: false; readonly error: AgentProfileResolutionError } => {
  const selection = resolveAgentProfile({
    ...(input.repoConfig.interactiveSession?.agentProfile === undefined
      ? {}
      : { repoSelection: input.repoConfig.interactiveSession.agentProfile }),
    ...(input.globalConfig.interactiveSession?.agentProfile === undefined
      ? {}
      : { globalSelection: input.globalConfig.interactiveSession.agentProfile }),
    ...(input.globalConfig.defaultAgentProfile === undefined
      ? {}
      : { defaultSelection: input.globalConfig.defaultAgentProfile }),
    ...(input.repoConfig.agentProfiles === undefined
      ? {}
      : { repoProfiles: input.repoConfig.agentProfiles }),
    ...(input.globalConfig.agentProfiles === undefined
      ? {}
      : { globalProfiles: input.globalConfig.agentProfiles }),
    requireModel: false,
    ...(input.globalConfigDirectory === undefined
      ? {}
      : { globalConfigDirectory: input.globalConfigDirectory }),
  });
  return selection.ok
    ? { ok: true, profile: selection.resolved }
    : selection.error._tag === "MissingAgentProfile" &&
        selection.error.selection === "default" &&
        input.globalConfig.defaultAgentProfile === undefined
      ? { ok: true, profile: undefined }
      : selection;
};

export function resolveAgentProfile(
  input: ProfileResolutionInput & { readonly requireModel: false },
):
  | { readonly ok: true; readonly resolved: InteractiveSessionAgentProfile }
  | { readonly ok: false; readonly error: AgentProfileResolutionError };
export function resolveAgentProfile(
  input: ProfileResolutionInput,
):
  | { readonly ok: true; readonly resolved: ResolvedReviewerPiAgentProfile }
  | { readonly ok: false; readonly error: AgentProfileResolutionError };
export function resolveAgentProfile(
  input: ProfileResolutionInput,
):
  | { readonly ok: true; readonly resolved: InteractiveSessionAgentProfile }
  | { readonly ok: false; readonly error: AgentProfileResolutionError } {
  const selection = input.repoSelection ?? input.globalSelection ?? input.defaultSelection;
  const selectionKind =
    input.repoSelection !== undefined || input.globalSelection !== undefined
      ? "explicit"
      : "default";

  if (selection === undefined) {
    return { ok: false, error: new MissingAgentProfile({ selection: selectionKind }) };
  }

  const profiles = selection.scope === "repo" ? input.repoProfiles : input.globalProfiles;
  const profile = profiles?.[selection.name];
  if (profile === undefined) {
    return {
      ok: false,
      error: new MissingAgentProfile({
        profileName: selection.name,
        scope: selection.scope,
        selection: selectionKind,
      }),
    };
  }

  if (profile.agentRuntime !== "pi") {
    return {
      ok: false,
      error: new UnsupportedAgentRuntime({
        profileName: selection.name,
        scope: selection.scope,
        agentRuntime: profile.agentRuntime,
      }),
    };
  }

  const model = profile.runtimeConfig?.model;
  if (input.requireModel !== false && (model === undefined || model.trim().length === 0)) {
    return {
      ok: false,
      error: new MissingAgentModel({
        profileName: selection.name,
        scope: selection.scope,
        agentRuntime: "pi",
      }),
    };
  }

  const resolved: InteractiveSessionAgentProfile = {
    agentProfile: selection.name,
    scope: selection.scope,
    profile:
      input.requireModel === false
        ? profile
        : {
            ...profile,
            runtimeConfig: { ...profile.runtimeConfig, model: model as string },
          },
  };
  if (input.globalConfigDirectory !== undefined) {
    Object.defineProperty(resolved, "globalConfigDirectory", {
      value: input.globalConfigDirectory,
      enumerable: false,
    });
  }

  return { ok: true, resolved };
}
