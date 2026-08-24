import { dirname } from "node:path";

import { Schema } from "effect";
import {
  type ResolvedReviewerPiAgentProfile,
  resolveAgentProfile,
} from "../agent/agentProfiles.js";
import type { AgentThinking } from "../agent/agentSession/agentSession.js";
import { configNameSchema, nonBlankStringSchema } from "../contracts/agentConfig.js";
import type { GlobalConfig } from "../contracts/globalConfig.js";
import type { RepoConfig } from "../contracts/repoConfig.js";

export type StallDetectionProfile = {
  readonly agentProfile: string;
  readonly scope: "repo" | "global";
  readonly model: string;
  readonly thinking: AgentThinking | null;
};

export const stallDetectionProfileSchema = Schema.Struct({
  agentProfile: configNameSchema,
  scope: Schema.Literal("repo", "global"),
  model: nonBlankStringSchema,
  thinking: Schema.NullOr(Schema.Literal("off", "minimal", "low", "medium", "high", "xhigh")),
});

export type ResolvedStallDetectionConfig = {
  readonly enabled: boolean;
  readonly profile: StallDetectionProfile | null;
};

export const resolveStallDetectionConfig = (input: {
  readonly repoConfig: RepoConfig;
  readonly globalConfig: GlobalConfig;
  readonly globalConfigPath: string;
}):
  | { readonly ok: true; readonly config: ResolvedStallDetectionConfig }
  | { readonly ok: false; readonly message: string } => {
  const repo = input.repoConfig.review?.stallDetection;
  const global = input.globalConfig.review?.stallDetection;
  const selected = repo ?? global;
  if (selected === undefined || !selected.enabled) {
    return { ok: true, config: { enabled: false, profile: null } };
  }

  const resolved = resolveAgentProfile({
    ...(repo?.agentProfile === undefined ? {} : { repoSelection: repo.agentProfile }),
    ...(global?.agentProfile === undefined ? {} : { globalSelection: global.agentProfile }),
    ...(input.globalConfig.defaultAgentProfile === undefined
      ? {}
      : { defaultSelection: input.globalConfig.defaultAgentProfile }),
    ...(input.repoConfig.agentProfiles === undefined
      ? {}
      : { repoProfiles: input.repoConfig.agentProfiles }),
    ...(input.globalConfig.agentProfiles === undefined
      ? {}
      : { globalProfiles: input.globalConfig.agentProfiles }),
    globalConfigDirectory: dirname(input.globalConfigPath),
  });
  if (!resolved.ok) return { ok: false, message: resolved.error.message };
  return {
    ok: true,
    config: {
      enabled: true,
      profile: stallDetectionProfile(resolved.resolved),
    },
  };
};

const stallDetectionProfile = (profile: ResolvedReviewerPiAgentProfile): StallDetectionProfile => ({
  agentProfile: profile.agentProfile,
  scope: profile.scope,
  model: profile.profile.runtimeConfig.model,
  thinking: profile.profile.runtimeConfig.thinking ?? null,
});
