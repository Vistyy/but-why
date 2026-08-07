import { dirname, join } from "node:path";
import { Effect } from "effect";

import { resolveInteractiveSessionAgentProfile } from "../../agent/agentProfiles.js";
import { validatePiAgentProfileResources } from "../../agent/piRuntime.js";
import { readGlobalConfig } from "../../init/globalConfig.js";
import { readRepoConfig } from "../../init/repoConfig.js";
import type { RepoLocalContext } from "../../init/repoContext.js";
import { taskSlugForId } from "../../task/taskId.js";
import type { ChangeStartRecord } from "../changeStartStore.js";
import {
  buildImplementerInitialPrompt,
  buildImplementerSystemPromptPaths,
} from "./implementerPrompt.js";
import type { InteractiveSessionHost } from "./interactiveSessionHost.js";

export type ChangeImplementResult =
  | {
      readonly ok: true;
      readonly change: ChangeStartRecord;
      readonly host: "herdr";
      readonly status: "started" | "already_active";
      readonly agentProfile?: string;
      readonly profileScope?: "repo" | "global";
    }
  | {
      readonly ok: false;
      readonly change: ChangeStartRecord;
      readonly code:
        | "host_unavailable"
        | "launch_failed"
        | "launch_indeterminate"
        | "pane_not_ready"
        | "repo_config_invalid"
        | "agent_profile_invalid";
      readonly message: string;
    }
  | { readonly ok: false; readonly code: "change_not_found" | "change_not_open" };

export const launchInteractiveImplementer = (input: {
  readonly context: RepoLocalContext;
  readonly change: ChangeStartRecord;
  readonly interactiveSessionHost: InteractiveSessionHost;
  readonly globalConfigPath: string;
  readonly implementerPrompt: string | undefined;
}): Effect.Effect<ChangeImplementResult, never> =>
  Effect.gen(function* () {
    const { context, change, interactiveSessionHost, globalConfigPath, implementerPrompt } = input;
    const managedRepoConfig = readRepoConfig(join(change.worktreePath, ".but-why", "config.json"));
    if (!managedRepoConfig.ok) {
      return {
        ok: false as const,
        code: "repo_config_invalid" as const,
        message: `Managed Worktree Repo Config is invalid: ${managedRepoConfig.error.message}`,
        change,
      };
    }
    const globalConfig = readGlobalConfig(globalConfigPath);
    if (!globalConfig.ok) {
      return {
        ok: false as const,
        code: "agent_profile_invalid" as const,
        message: `Global Config is invalid: ${globalConfig.error.message}`,
        change,
      };
    }
    const agentProfile = resolveInteractiveSessionAgentProfile({
      repoConfig: managedRepoConfig.config,
      globalConfig: globalConfig.config,
      globalConfigDirectory: dirname(globalConfigPath),
    });
    if (!agentProfile.ok) {
      return {
        ok: false as const,
        code: "agent_profile_invalid" as const,
        message: agentProfileErrorMessage(agentProfile.error),
        change,
      };
    }
    const resolvedAgentProfile = agentProfile.profile;
    if (resolvedAgentProfile === undefined) {
      return {
        ok: false as const,
        code: "agent_profile_invalid" as const,
        message: "Interactive Session Agent Profile is not configured.",
        change,
      };
    }
    const resources = validatePiAgentProfileResources(resolvedAgentProfile, change.worktreePath);
    if (!resources.ok) {
      return {
        ok: false as const,
        code: "agent_profile_invalid" as const,
        message: resources.error.message,
        change,
      };
    }
    const launched = yield* Effect.tryPromise({
      try: (signal) =>
        interactiveSessionHost.launch(
          {
            changeId: change.id,
            hostSessionName: hostSessionNameForChange(change),
            agentSessionName: agentSessionNameForChange(change),
            repositoryPath: context.mainCheckoutRoot,
            worktreePath: change.worktreePath,
            systemPromptPaths: buildImplementerSystemPromptPaths(),
            initialPrompt: buildImplementerInitialPrompt({
              changeId: change.id,
              worktreePath: change.worktreePath,
              ...(change.prepareFailure === null ? {} : { prepareFailure: change.prepareFailure }),
              ...(implementerPrompt === undefined ? {} : { implementerPrompt }),
            }),
            agentProfile: resolvedAgentProfile,
            globalConfigDirectory: dirname(globalConfigPath),
          },
          signal,
        ),
      catch: (error) => (error instanceof Error ? error.message : String(error)),
    }).pipe(
      Effect.match({
        onFailure: (message) => ({ ok: false as const, message }),
        onSuccess: (result) => ({ ok: true as const, result }),
      }),
    );
    if (!launched.ok) {
      return {
        ok: false as const,
        code: "launch_failed" as const,
        message: launched.message,
        change,
      };
    }
    if (!launched.result.ok) {
      return { change, ...launched.result };
    }
    return {
      change,
      ...launched.result,
      agentProfile: resolvedAgentProfile.agentProfile,
      profileScope: resolvedAgentProfile.scope,
    };
  });

const hostSessionNameForChange = (change: ChangeStartRecord): string =>
  change.taskId === null ? `change-${change.id.slice(0, 8)}` : taskSlugForId(change.taskId);

const agentSessionNameForChange = (change: ChangeStartRecord): string =>
  change.taskId === null || change.acceptanceContext === null
    ? `Change ${change.id}`
    : `${change.taskId} ${change.acceptanceContext.title}`;

const agentProfileErrorMessage = (error: {
  readonly _tag: string;
  readonly profileName?: string;
  readonly scope?: "repo" | "global";
  readonly agentRuntime?: string;
}): string => {
  const profile = `Interactive Session Agent Profile "${error.profileName ?? "<missing>"}"`;
  const scope = error.scope === undefined ? "" : ` in ${error.scope} scope`;
  if (error._tag === "MissingAgentProfile") {
    return `${profile}${scope} was not found.`;
  }
  if (error._tag === "MissingAgentModel") {
    return `${profile}${scope} has no Pi model in runtimeConfig.`;
  }
  return `${profile}${scope} must use the Pi agent runtime; it uses "${error.agentRuntime ?? "unknown"}".`;
};
