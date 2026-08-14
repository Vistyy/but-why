import { Data, type Effect } from "effect";
import type { AgentEnvironmentCommand } from "./agentEnvironment.js";
import type { ResolvedPiAgentProfile } from "./agentProfiles.js";
import type { TokenUsage } from "./tokenUsage.js";

export class ReviewerProcessExecutionFailed extends Data.TaggedError(
  "ReviewerProcessExecutionFailed",
)<{
  readonly message: string;
  readonly sessionUsability: "unusable" | "unknown";
}> {}

export type ReviewerProcessResult = {
  readonly stdout: string;
  readonly invocationUsage?: TokenUsage | null;
  readonly sessionReference?: string;
  readonly sessionFilePath?: string;
  readonly resume?: (
    prompt: string,
  ) => Effect.Effect<ReviewerProcessResult, ReviewerProcessExecutionFailed>;
};

export type ReviewerProcessInput = {
  readonly reviewer: string;
  readonly prompt: string;
  readonly profile: ResolvedPiAgentProfile;
  readonly commandCwd: string;
  readonly resourceRoot: string;
  readonly agentEnvironment?: AgentEnvironmentCommand;
  readonly sessionStorageRoot?: string;
  /** The stable physical conversation identity used when starting a new continuation. */
  readonly sessionId?: string;
  readonly resumeSession?: string;
};

export type ReviewerProcessExecutor = {
  readonly execute: (
    input: ReviewerProcessInput,
  ) => Effect.Effect<ReviewerProcessResult, ReviewerProcessExecutionFailed>;
};
