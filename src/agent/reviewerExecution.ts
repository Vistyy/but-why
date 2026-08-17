import { Data, type Effect } from "effect";
import type { AgentEnvironmentCommand } from "./agentEnvironment.js";
import type { ResolvedPiAgentProfile } from "./agentProfiles.js";
import type { TokenUsage } from "./tokenUsage.js";

export class ReviewerProcessExecutionFailed extends Data.TaggedError(
  "ReviewerProcessExecutionFailed",
)<{
  readonly message: string;
  readonly sessionUsability: "unusable" | "unknown";
  readonly invocationUsage?: TokenUsage | null;
  readonly sessionReference?: string;
  readonly sessionFilePath?: string;
}> {}

export type ReviewerProcessResult = {
  readonly stdout: string;
  readonly invocationUsage?: TokenUsage | null;
  readonly sessionReference?: string;
  readonly sessionFilePath?: string;
};

export type ReviewerProcessInput = {
  readonly reviewer: string;
  readonly systemPrompt: string;
  readonly prompt: string;
  readonly profile: ResolvedPiAgentProfile;
  readonly commandCwd: string;
  readonly resourceRoot: string;
  readonly agentEnvironment?: AgentEnvironmentCommand;
  readonly sessionStorageRoot?: string;
  /** The stable physical conversation identity used when starting a new continuation. */
  readonly sessionId?: string;
  readonly resumeSession?: string;
  readonly resumeSessionFilePath?: string;
};

export type ReviewerProcessExecutor = {
  readonly execute: (
    input: ReviewerProcessInput,
  ) => Effect.Effect<ReviewerProcessResult, ReviewerProcessExecutionFailed>;
};
