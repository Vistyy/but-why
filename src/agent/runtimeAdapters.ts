export const agentRuntimeAdapters = {
  pi: { supportsHarnessDefaultModel: false },
  "claude-code": { supportsHarnessDefaultModel: false },
  codex: { supportsHarnessDefaultModel: false },
  cursor: { supportsHarnessDefaultModel: false },
  opencode: { supportsHarnessDefaultModel: false },
  copilot: { supportsHarnessDefaultModel: false },
} as const;

export type SupportedAgentRuntime = keyof typeof agentRuntimeAdapters;

export const supportedAgentRuntimes = Object.keys(agentRuntimeAdapters) as SupportedAgentRuntime[];

export const isSupportedAgentRuntime = (runtime: string): runtime is SupportedAgentRuntime =>
  Object.hasOwn(agentRuntimeAdapters, runtime);
