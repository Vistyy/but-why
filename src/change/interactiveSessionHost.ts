import type { InteractiveSessionAgentProfile } from "../agent/agentProfiles.js";
import type { AgentEnvironmentCommand } from "../agent/agentEnvironment.js";
import type { ImplementationAdvisorConfig } from "./implementationAdvisorConfig.js";
import type { AcceptanceContextSnapshotV1 } from "./validationRun/acceptanceContextSnapshot.js";
import type { ImplementationDecision } from "./implementationDecision.js";

export type InteractiveSessionHost = {
  readonly launch: (
    input: InteractiveSessionLaunchInput,
    signal?: AbortSignal,
  ) => Promise<InteractiveSessionLaunchResult>;
};

export type ImplementationAdvisorLaunchContext = {
  readonly changeId: string;
  readonly acceptanceContext: AcceptanceContextSnapshotV1 | null;
  readonly implementationDecisions: readonly ImplementationDecision[];
};

export type InteractiveSessionLaunchWarning = {
  readonly code: "implementation_advisor_preflight_failed";
  readonly message: string;
  readonly details: { readonly path: string; readonly failure: string };
};

export type InteractiveSessionLaunchInput = {
  readonly changeId: string;
  readonly herdrName?: string;
  readonly piSessionName?: string;
  readonly repositoryPath: string;
  readonly worktreePath: string;
  readonly systemPrompt?: string;
  readonly initialPrompt: string | undefined;
  readonly agentProfile?: InteractiveSessionAgentProfile;
  readonly globalConfigDirectory?: string;
  readonly agentEnvironment?: AgentEnvironmentCommand;
  readonly implementationAdvisor?: ImplementationAdvisorConfig;
  readonly implementationAdvisorContext?: ImplementationAdvisorLaunchContext;
};

export type InteractiveSessionLaunchResult =
  | {
      readonly ok: true;
      readonly host: "herdr";
      readonly status: "started" | "already_active";
      readonly warning?: InteractiveSessionLaunchWarning;
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
