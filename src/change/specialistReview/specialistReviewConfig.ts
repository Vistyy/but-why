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
  readonly profileSource: "repo" | "global";
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
    ...(definition.agentProfile === undefined ? {} : { agentProfile: definition.agentProfile }),
    ...(input.repoConfig.agentProfiles === undefined
      ? {}
      : { repoProfiles: input.repoConfig.agentProfiles }),
    globalConfig: input.globalConfig,
  });
  if (!profileResolution.ok) return profileResolution;
  if (
    profileResolution.resolved.profile.agentRuntime !== "pi" ||
    profileResolution.resolved.profile.agentModel === undefined
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
      profileSource: profileResolution.resolved.source,
      profile: {
        agentRuntime: "pi",
        agentModel: profileResolution.resolved.profile.agentModel,
        ...(profileResolution.resolved.profile.thinking === undefined
          ? {}
          : {
              thinking: profileResolution.resolved.profile.thinking as Exclude<
                ResolvedPiAgentProfile["thinking"],
                undefined
              >,
            }),
      },
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
