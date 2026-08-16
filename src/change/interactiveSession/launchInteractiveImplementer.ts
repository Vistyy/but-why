import { Effect } from "effect";

import type { ChangeStartRecord } from "../changeStartStore.js";
import {
  buildImplementerInitialPrompt,
  buildImplementerSystemPromptPaths,
} from "./implementerPrompt.js";
import type { InteractiveSessionHost } from "./interactiveSessionHost.js";
import type { InteractiveSessionProfileLoader } from "./interactiveSessionProfile.js";

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
  readonly repositoryPath: string;
  readonly change: ChangeStartRecord;
  readonly interactiveSessionHost: InteractiveSessionHost;
  readonly globalConfigPath: string;
  readonly profileLoader: InteractiveSessionProfileLoader;
  readonly implementerPrompt: string | undefined;
}): Effect.Effect<ChangeImplementResult, never> =>
  Effect.gen(function* () {
    const {
      repositoryPath,
      change,
      interactiveSessionHost,
      globalConfigPath,
      profileLoader,
      implementerPrompt,
    } = input;
    const loadedProfile = profileLoader(change.worktreePath, globalConfigPath);
    if (!loadedProfile.ok) return { ...loadedProfile, change };
    const resolvedAgentProfile = loadedProfile.profile;
    const launched = yield* Effect.tryPromise({
      try: (signal) =>
        interactiveSessionHost.launch(
          {
            changeId: change.id,
            hostSessionName: hostSessionNameForChange(change),
            agentSessionName: agentSessionNameForChange(change),
            repositoryPath,
            worktreePath: change.worktreePath,
            systemPromptPaths: buildImplementerSystemPromptPaths(),
            initialPrompt: buildImplementerInitialPrompt({
              changeId: change.id,
              worktreePath: change.worktreePath,
              ...(change.prepareFailure === null ? {} : { prepareFailure: change.prepareFailure }),
              ...(implementerPrompt === undefined ? {} : { implementerPrompt }),
            }),
            agentProfile: resolvedAgentProfile,
            globalConfigDirectory: loadedProfile.globalConfigDirectory,
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

const hostSessionNameForChange = (change: ChangeStartRecord): string => change.id;

const agentSessionNameForChange = (change: ChangeStartRecord): string =>
  change.acceptanceContext === null
    ? `Change ${change.id}`
    : `${change.id} ${change.acceptanceContext.title}`;
