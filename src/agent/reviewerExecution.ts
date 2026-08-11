import { Data, type Effect } from "effect";

import type { TokenUsage } from "../contracts/tokenUsage.js";
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
  readonly invocationUsage?: TokenUsage | null;
  readonly sessionReference?: string;
  readonly sessionFilePath?: string;
  readonly resume?: (prompt: string) => Promise<ReviewerProcessResult>;
  readonly resumeEffect?: (
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
  readonly resumeSession?: string;
};

export type ReviewerProcessExecutor = {
  readonly execute: (input: ReviewerProcessInput) => Promise<ReviewerProcessResult>;
  readonly effect?: (
    input: ReviewerProcessInput,
  ) => Effect.Effect<ReviewerProcessResult, ReviewerProcessExecutionFailed>;
};

export type ReviewerProcessEffectExecutor = ReviewerProcessExecutor & {
  readonly effect: (
    input: ReviewerProcessInput,
  ) => Effect.Effect<ReviewerProcessResult, ReviewerProcessExecutionFailed>;
};
