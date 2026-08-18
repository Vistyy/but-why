import { dirname, join } from "node:path";

import {
  type ResolvedReviewerPiAgentProfile,
  resolveAgentProfile,
} from "../../agent/agentProfiles.js";
import type { GlobalConfig } from "../../contracts/globalConfig.js";
import type { RepoConfig } from "../../contracts/repoConfig.js";
import { readAcceptanceInstructions } from "../../init/acceptanceInstructions.js";
import { defaultAcceptanceInstructions } from "../../reviewerPrompts/acceptanceReviewerPrompt.js";
import {
  InvalidReviewerConfig,
  type SubmitRejectionError,
} from "../submit/submitRejectionErrors.js";

export type AcceptanceReviewPolicy = {
  readonly instructions: string;
  readonly instructionsSource: "repo" | "global" | "built_in";
  readonly profile: ResolvedReviewerPiAgentProfile;
};

export const resolveAcceptanceReviewPolicy = (input: {
  readonly repoConfig: RepoConfig;
  readonly globalConfig: GlobalConfig;
  readonly repoRoot: string;
  readonly globalConfigPath: string;
  readonly readRepoInstructions?: (
    path: string,
  ) =>
    | { readonly ok: true; readonly content: string }
    | { readonly ok: false; readonly message: string };
}):
  | { readonly ok: true; readonly policy: AcceptanceReviewPolicy }
  | { readonly ok: false; readonly error: SubmitRejectionError } => {
  const resolution = resolveAgentProfile({
    ...(input.repoConfig.review?.acceptance?.agentProfile === undefined
      ? {}
      : { repoSelection: input.repoConfig.review.acceptance.agentProfile }),
    ...(input.globalConfig.review?.acceptance?.agentProfile === undefined
      ? {}
      : { globalSelection: input.globalConfig.review.acceptance.agentProfile }),
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

  if (!resolution.ok) return resolution;
  const instructions = resolveInstructions(input);
  if (!instructions.ok) return instructions;

  return {
    ok: true,
    policy: {
      instructions: instructions.instructions,
      instructionsSource: instructions.instructionsSource,
      profile: resolution.resolved,
    },
  };
};

const resolveInstructions = (input: {
  readonly repoConfig: RepoConfig;
  readonly globalConfig: GlobalConfig;
  readonly repoRoot: string;
  readonly globalConfigPath: string;
  readonly readRepoInstructions?: (
    path: string,
  ) =>
    | { readonly ok: true; readonly content: string }
    | { readonly ok: false; readonly message: string };
}):
  | (Pick<AcceptanceReviewPolicy, "instructions" | "instructionsSource"> & { readonly ok: true })
  | { readonly ok: false; readonly error: InvalidReviewerConfig } => {
  const repoInstructionsFile = input.repoConfig.review?.acceptance?.instructionsFile;
  if (repoInstructionsFile !== undefined) {
    if (input.readRepoInstructions !== undefined) {
      const result = input.readRepoInstructions(repoInstructionsFile);
      return result.ok
        ? nonBlankInstructions(result.content, "repo", repoInstructionsFile)
        : invalidInstructions(result.message);
    }
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

const nonBlankInstructions = (
  content: string,
  instructionsSource: "repo" | "global",
  path: string,
):
  | (Pick<AcceptanceReviewPolicy, "instructions" | "instructionsSource"> & { readonly ok: true })
  | { readonly ok: false; readonly error: InvalidReviewerConfig } =>
  content.trim().length === 0
    ? invalidInstructions(`Acceptance Reviewer instructions file is empty: ${path}`)
    : { ok: true, instructions: content, instructionsSource };

const invalidInstructions = (
  message: string,
): { readonly ok: false; readonly error: InvalidReviewerConfig } => ({
  ok: false,
  error: new InvalidReviewerConfig({ message }),
});
