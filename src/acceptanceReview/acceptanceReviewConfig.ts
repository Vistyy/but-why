import { dirname, join } from "node:path";

import { resolveAgentProfile, type ResolvedPiAgentProfile } from "../agent/agentProfiles.js";
import type { GlobalConfig } from "../contracts/globalConfig.js";
import type { RepoConfig } from "../contracts/repoConfig.js";
import { defaultAcceptanceInstructions } from "../agent/reviewerPrompts.js";
import { readAcceptanceInstructions } from "../init/acceptanceInstructions.js";
import {
  InvalidReviewerConfig,
  type SubmitRejectionError,
} from "../submit/submitRejectionErrors.js";

export type AcceptanceReviewPolicy = {
  readonly instructions: string;
  readonly instructionsSource: "repo" | "global" | "built_in";
  readonly agentProfile: string;
  readonly profileSource: "repo" | "global";
  readonly profile: ResolvedPiAgentProfile;
};

export const resolveAcceptanceReviewPolicy = (input: {
  readonly repoConfig: RepoConfig;
  readonly globalConfig: GlobalConfig;
  readonly repoRoot: string;
  readonly globalConfigPath: string;
}):
  | { readonly ok: true; readonly policy: AcceptanceReviewPolicy }
  | { readonly ok: false; readonly error: SubmitRejectionError } => {
  const selectedProfile =
    input.repoConfig.review?.acceptance?.agentProfile ??
    input.globalConfig.review?.acceptance?.agentProfile;
  const resolution = resolveAgentProfile({
    ...(selectedProfile === undefined ? {} : { agentProfile: selectedProfile }),
    ...(input.repoConfig.agentProfiles === undefined
      ? {}
      : { repoProfiles: input.repoConfig.agentProfiles }),
    globalConfig: input.globalConfig,
  });

  if (!resolution.ok) return resolution;
  if (
    resolution.resolved.profile.agentRuntime !== "pi" ||
    resolution.resolved.profile.agentModel === undefined
  ) {
    return {
      ok: false,
      error: new InvalidReviewerConfig({
        profileName: resolution.resolved.agentProfile,
        message: "Acceptance Review requires a Pi Agent Profile.",
      }),
    };
  }

  const instructions = resolveInstructions(input);
  if (!instructions.ok) return instructions;

  return {
    ok: true,
    policy: {
      ...instructions,
      agentProfile: resolution.resolved.agentProfile,
      profileSource: resolution.resolved.source,
      profile: {
        agentRuntime: "pi",
        agentModel: resolution.resolved.profile.agentModel,
        ...(resolution.resolved.profile.thinking === undefined
          ? {}
          : {
              thinking: resolution.resolved.profile.thinking as Exclude<
                ResolvedPiAgentProfile["thinking"],
                undefined
              >,
            }),
      },
    },
  };
};

const resolveInstructions = (input: {
  readonly repoConfig: RepoConfig;
  readonly globalConfig: GlobalConfig;
  readonly repoRoot: string;
  readonly globalConfigPath: string;
}):
  | (Pick<AcceptanceReviewPolicy, "instructions" | "instructionsSource"> & { readonly ok: true })
  | { readonly ok: false; readonly error: InvalidReviewerConfig } => {
  const repoInstructionsFile = input.repoConfig.review?.acceptance?.instructionsFile;
  if (repoInstructionsFile !== undefined) {
    return readInstructions(join(input.repoRoot, repoInstructionsFile), "repo");
  }

  const globalInstructionsFile = input.globalConfig.review?.acceptance?.instructionsFile;
  if (globalInstructionsFile !== undefined) {
    return readInstructions(
      join(dirname(input.globalConfigPath), globalInstructionsFile),
      "global",
    );
  }

  return { ok: true, instructions: defaultAcceptanceInstructions, instructionsSource: "built_in" };
};

const readInstructions = (
  path: string,
  instructionsSource: "repo" | "global",
):
  | (Pick<AcceptanceReviewPolicy, "instructions" | "instructionsSource"> & { readonly ok: true })
  | { readonly ok: false; readonly error: InvalidReviewerConfig } => {
  const result = readAcceptanceInstructions(path);
  return result.ok
    ? { ok: true, instructions: result.instructions, instructionsSource }
    : invalidInstructions(result.message);
};

const invalidInstructions = (
  message: string,
): { readonly ok: false; readonly error: InvalidReviewerConfig } => ({
  ok: false,
  error: new InvalidReviewerConfig({ message }),
});
