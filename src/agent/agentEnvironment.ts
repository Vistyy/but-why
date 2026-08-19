import type { RepoConfig } from "../contracts/repoConfig.js";

export type AgentEnvironmentCommand = readonly [string, ...string[]];

export const repoAgentEnvironment = (config: RepoConfig): AgentEnvironmentCommand | undefined =>
  config.agentEnvironment?.command;

export const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
