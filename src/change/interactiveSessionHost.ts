import type { InteractiveSessionAgentProfile } from "../agent/agentProfiles.js";
import type { AgentEnvironmentCommand } from "../agent/agentEnvironment.js";

export type InteractiveSessionHost = {
  readonly launch: (
    input: InteractiveSessionLaunchInput,
    signal?: AbortSignal,
  ) => Promise<InteractiveSessionLaunchResult>;
};

export type InteractiveSessionLaunchInput = {
  readonly changeId: string;
  readonly repositoryPath: string;
  readonly worktreePath: string;
  readonly systemPrompt?: string;
  readonly initialPrompt: string | undefined;
  readonly agentProfile?: InteractiveSessionAgentProfile;
  readonly globalConfigDirectory?: string;
  readonly agentEnvironment?: AgentEnvironmentCommand;
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
      readonly evidence?: InteractiveSessionLaunchEvidence;
    };

export type InteractiveSessionLaunchEvidence = {
  readonly startupOutput?: string;
  readonly exitEvidence?: string;
};
