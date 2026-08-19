import type { AgentInvocationRecord } from "../agent/agentSession/agentSession.js";

export const agentInvocationView = (invocation: AgentInvocationRecord) => ({
  ...invocation,
  usage:
    invocation.usage === null
      ? null
      : {
          input: invocation.usage.inputTokens,
          cacheRead: invocation.usage.cachedInputTokens,
          cacheWrite: invocation.usage.cacheWriteTokens,
          output: invocation.usage.outputTokens,
          total: invocation.usage.totalTokens,
        },
});
