export const agentRuntimeAdapters = {
  pi: { supportsHarnessDefaultModel: true },
} as const;

export type SupportedAgentRuntime = keyof typeof agentRuntimeAdapters;

export const supportedAgentRuntimes = Object.keys(agentRuntimeAdapters) as SupportedAgentRuntime[];

export const isSupportedAgentRuntime = (runtime: string): runtime is SupportedAgentRuntime =>
  Object.hasOwn(agentRuntimeAdapters, runtime);
