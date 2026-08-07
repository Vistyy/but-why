import type { InteractiveSessionAgentProfile } from "../../agent/agentProfiles.js";

export type InteractiveSessionHost = {
  readonly launch: (
    input: InteractiveSessionLaunchInput,
    signal?: AbortSignal,
  ) => Promise<InteractiveSessionLaunchResult>;
};

export type InteractiveSessionLaunchInput = {
  readonly changeId: string;
  readonly hostSessionName?: string;
  readonly agentSessionName?: string;
  readonly repositoryPath: string;
  readonly worktreePath: string;
  readonly systemPromptPaths: readonly [string, string];
  readonly initialPrompt: string | undefined;
  readonly agentProfile?: InteractiveSessionAgentProfile;
  readonly globalConfigDirectory?: string;
};

export type InteractiveSessionLaunchResult =
  | {
      readonly ok: true;
      readonly host: "herdr";
      readonly status: "started" | "already_active";
    }
  | {
      readonly ok: false;
      readonly code: "host_unavailable" | "launch_failed" | "launch_indeterminate";
      readonly message: string;
    };
