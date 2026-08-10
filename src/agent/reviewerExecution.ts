import { Data } from "effect";

import type { AgentEnvironmentCommand } from "./agentEnvironment.js";
import type { ResolvedPiAgentProfile } from "./agentProfiles.js";

export class ReviewerProcessExecutionFailed extends Data.TaggedError(
  "ReviewerProcessExecutionFailed",
)<{
  readonly message: string;
  readonly sessionUsability: "unusable" | "unknown";
}> {}

export type ReviewerProcessResult = {
  readonly stdout: string;
  readonly sessionReference?: string;
  readonly sessionFilePath?: string;
  readonly sessionCaptureUnavailable?: true;
  readonly resume?: (prompt: string) => Promise<ReviewerProcessResult>;
};

export type ReviewerProcessExecutor = {
  readonly execute: (input: {
    readonly reviewer: string;
    readonly prompt: string;
    readonly profile: ResolvedPiAgentProfile;
    readonly commandCwd: string;
    readonly resourceRoot: string;
    readonly agentEnvironment?: AgentEnvironmentCommand;
    readonly sessionStorageRoot?: string;
    readonly resumeSession?: string;
    readonly onSessionCaptureFailure: () => void;
  }) => Promise<ReviewerProcessResult>;
};
