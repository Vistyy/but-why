import { dirname, join } from "node:path";

import { resolveAgentProfile, type ResolvedPiAgentProfile } from "../../agent/agentProfiles.js";
import type { GlobalConfig } from "../../contracts/globalConfig.js";
import type { RepoConfig, ReviewerConfig } from "../../contracts/repoConfig.js";
import { readAcceptanceInstructions } from "../../init/acceptanceInstructions.js";
import {
  InvalidReviewerConfig,
  type SubmitRejectionError,
} from "../submit/submitRejectionErrors.js";

export type SpecialistReviewPolicy = {
  readonly id: string;
  readonly instructions: string;
  readonly instructionsSource: "repo" | "global";
  readonly agentProfile: string;
  readonly profileScope: "repo" | "global";
  readonly profile: ResolvedPiAgentProfile;
};

export const resolveSpecialistReviewPolicies = (input: {
  readonly repoConfig: RepoConfig;
  readonly globalConfig: GlobalConfig;
  readonly repoRoot: string;
  readonly globalConfigPath: string;
}):
  | { readonly ok: true; readonly policies: readonly SpecialistReviewPolicy[] }
  | { readonly ok: false; readonly error: SubmitRejectionError } => {
  const active =
    input.repoConfig.review?.specialists ?? input.globalConfig.review?.specialists ?? [];
  const seen = new Set<string>();
  for (const id of active) {
    if (id === "acceptance") return invalid("Specialist is reserved: acceptance");
    if (seen.has(id)) return invalid(`Duplicate Specialist: ${id}`);
    seen.add(id);
  }

  const policies: SpecialistReviewPolicy[] = [];
  for (const id of active) {
    const resolved = resolveSpecialist(input, id);
    if (!resolved.ok) return resolved;
    policies.push(resolved.policy);
  }

  return { ok: true, policies };
};

const resolveSpecialist = (
  input: {
    readonly repoConfig: RepoConfig;
    readonly globalConfig: GlobalConfig;
    readonly repoRoot: string;
    readonly globalConfigPath: string;
  },
  id: string,
):
  | { readonly ok: true; readonly policy: SpecialistReviewPolicy }
  | { readonly ok: false; readonly error: SubmitRejectionError } => {
  const repoDefinition = input.repoConfig.reviewers?.[id];
  const globalDefinition = input.globalConfig.reviewers?.[id];
  const definition: ReviewerConfig | typeof globalDefinition = repoDefinition ?? globalDefinition;
  if (definition === undefined) return invalid(`Specialist is not defined: ${id}`);

  const profileResolution = resolveAgentProfile({
    ...(repoDefinition?.agentProfile === undefined
      ? {}
      : { repoSelection: repoDefinition.agentProfile }),
    ...(globalDefinition?.agentProfile === undefined
      ? {}
      : { globalSelection: globalDefinition.agentProfile }),
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
  if (!profileResolution.ok) return profileResolution;
  if (
    profileResolution.resolved.profile.agentRuntime !== "pi" ||
    profileResolution.resolved.profile.runtimeConfig?.model === undefined
  ) {
    return invalid(
      "Specialist Review requires a Pi Agent Profile.",
      profileResolution.resolved.agentProfile,
    );
  }

  const instructionsSource = repoDefinition === undefined ? "global" : "repo";
  const instructionsPath =
    instructionsSource === "repo"
      ? join(input.repoRoot, definition.instructionsFile)
      : join(dirname(input.globalConfigPath), definition.instructionsFile);
  const instructions = readAcceptanceInstructions(instructionsPath);
  if (!instructions.ok) return invalid(instructions.message);

  return {
    ok: true,
    policy: {
      id,
      instructions: instructions.instructions,
      instructionsSource,
      agentProfile: profileResolution.resolved.agentProfile,
      profileScope: profileResolution.resolved.scope,
      profile: profileResolution.resolved,
    },
  };
};

const invalid = (
  message: string,
  profileName?: string,
): { readonly ok: false; readonly error: InvalidReviewerConfig } => ({
  ok: false,
  error: new InvalidReviewerConfig({
    message,
    ...(profileName === undefined ? {} : { profileName }),
  }),
});
