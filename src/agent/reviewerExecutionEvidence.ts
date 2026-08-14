import type { AgentInvocationRecord } from "./agentSession/agentSession.js";
import type { TokenUsage } from "./tokenUsage.js";

export type ReviewerExecutionEvidence = {
  readonly continuity?: "fresh" | "resumed" | "restarted";
  readonly identityFingerprint?: string;
  readonly restartReason?: string;
  readonly durationMs?: number;
  readonly reviewCalls?: number;
  readonly invocationUsage?: readonly (TokenUsage | null)[];
  readonly agentSessionId?: number;
  readonly invocations?: readonly AgentInvocationRecord[];
};
