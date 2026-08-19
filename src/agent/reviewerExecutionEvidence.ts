import type { AgentInvocationRecord } from "./agentSession/agentSession.js";

export type ReviewerExecutionEvidence = {
  readonly agentSessionId: number;
  readonly invocations: readonly AgentInvocationRecord[];
};
