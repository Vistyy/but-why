import { dirname, join } from "node:path";
import {
  type ResolvedReviewerPiAgentProfile,
  resolveAgentProfile,
} from "../../agent/agentProfiles.js";
import { validatePiAgentProfileResources } from "../../agent/piRuntime.js";
import { isPackageAgentResource } from "../../contracts/agentConfig.js";
import type { GlobalConfig } from "../../contracts/globalConfig.js";
import type { RepoConfig } from "../../contracts/repoConfig.js";
import type { TaskReviewPolicySnapshot } from "./taskReview.js";

export type ResolvedTaskReviewPolicy = {
  readonly profile: ResolvedReviewerPiAgentProfile;
  readonly snapshot: TaskReviewPolicySnapshot;
};

export type TaskReviewPolicyResolutionResult =
  | { readonly ok: true; readonly policy: ResolvedTaskReviewPolicy }
  | { readonly ok: false; readonly message: string };

export const resolveTaskReviewPolicy = (input: {
  readonly repoConfig: RepoConfig;
  readonly globalConfig: GlobalConfig;
  readonly globalConfigPath: string;
  readonly builtInInstructions: string;
  readonly readRepoGuidance: (
    path: string,
  ) =>
    | { readonly ok: true; readonly content: string }
    | { readonly ok: false; readonly message: string };
  readonly readGlobalGuidance: (
    path: string,
  ) =>
    | { readonly ok: true; readonly content: string }
    | { readonly ok: false; readonly message: string };
}): TaskReviewPolicyResolutionResult => {
  const profileResolution = resolveAgentProfile({
    ...(input.repoConfig.review?.task?.agentProfile === undefined
      ? {}
      : { repoSelection: input.repoConfig.review.task.agentProfile }),
    ...(input.globalConfig.review?.task?.agentProfile === undefined
      ? {}
      : { globalSelection: input.globalConfig.review.task.agentProfile }),
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
  if (!profileResolution.ok) {
    return { ok: false, message: profileResolutionMessage(profileResolution.error) };
  }

  const profile = profileResolution.resolved;
  const resources = validateTaskReviewResources(profile);
  if (!resources.ok) return resources;

  const guidance = resolveGuidance(input);
  if (!guidance.ok) return guidance;

  return {
    ok: true,
    policy: {
      profile,
      snapshot: {
        profile: {
          agentProfile: profile.agentProfile,
          scope: profile.scope,
          profile: profile.profile,
          ...(profile.globalConfigDirectory === undefined
            ? {}
            : { globalConfigDirectory: profile.globalConfigDirectory }),
        },
        builtInInstructions: input.builtInInstructions,
        guidance: guidance.guidance,
      },
    },
  };
};

const resolveGuidance = (input: {
  readonly repoConfig: RepoConfig;
  readonly globalConfig: GlobalConfig;
  readonly globalConfigPath: string;
  readonly readRepoGuidance: (
    path: string,
  ) =>
    | { readonly ok: true; readonly content: string }
    | { readonly ok: false; readonly message: string };
  readonly readGlobalGuidance: (
    path: string,
  ) =>
    | { readonly ok: true; readonly content: string }
    | { readonly ok: false; readonly message: string };
}):
  | {
      readonly ok: true;
      readonly guidance: TaskReviewPolicySnapshot["guidance"];
    }
  | { readonly ok: false; readonly message: string } => {
  const repoPath = input.repoConfig.review?.task?.instructionsFile;
  if (repoPath !== undefined) {
    const read = input.readRepoGuidance(repoPath);
    return read.ok
      ? nonEmptyGuidance(read.content, "repo", repoPath)
      : { ok: false, message: read.message };
  }

  const globalPath = input.globalConfig.review?.task?.instructionsFile;
  if (globalPath !== undefined) {
    const resolvedPath = join(dirname(input.globalConfigPath), globalPath);
    const read = input.readGlobalGuidance(resolvedPath);
    return read.ok
      ? nonEmptyGuidance(read.content, "global", resolvedPath)
      : { ok: false, message: read.message };
  }

  return { ok: true, guidance: null };
};

const nonEmptyGuidance = (
  content: string,
  source: "repo" | "global",
  path: string,
):
  | { readonly ok: true; readonly guidance: NonNullable<TaskReviewPolicySnapshot["guidance"]> }
  | { readonly ok: false; readonly message: string } =>
  content.trim().length === 0
    ? { ok: false, message: `Task Review guidance file is empty: ${path}` }
    : { ok: true, guidance: { content, source } };

const validateTaskReviewResources = (
  profile: ResolvedReviewerPiAgentProfile,
): { readonly ok: true } | { readonly ok: false; readonly message: string } => {
  if (profile.scope === "global") {
    const validated = validatePiAgentProfileResources(profile, ".");
    return validated.ok ? validated : { ok: false, message: validated.error.message };
  }

  const resources = [
    ...(profile.profile.runtimeConfig?.extensions ?? []),
    ...(profile.profile.runtimeConfig?.skills ?? []),
  ];
  const unsupported = resources.find((source) => !isPackageAgentResource(source));
  return unsupported === undefined
    ? { ok: true }
    : {
        ok: false,
        message: `Agent Profile "${profile.agentProfile}" in repo scope uses unsupported repository-relative Task Review resource "${unsupported}".`,
      };
};

const profileResolutionMessage = (
  error: Exclude<ReturnType<typeof resolveAgentProfile>, { readonly ok: true }>["error"],
): string => {
  if (error._tag === "MissingAgentProfile") {
    if (error.profileName === undefined) {
      return "Global Config needs a default Agent Profile for Task Review.";
    }
    return `${error.scope === "repo" ? "Repo" : "Global"} Agent Profile "${error.profileName}" was not found.`;
  }
  if (error._tag === "MissingAgentModel") {
    return `${error.scope === "repo" ? "Repo" : "Global"} Agent Profile "${error.profileName}" has no Pi model in runtimeConfig.`;
  }
  return `${error.scope === "repo" ? "Repo" : "Global"} Agent Profile "${error.profileName}" uses unsupported runtime "${error.agentRuntime}".`;
};
