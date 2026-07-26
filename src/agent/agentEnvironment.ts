import type { RepoConfig } from "../contracts/repoConfig.js";

export type AgentEnvironmentCommand = readonly string[];

export const repoAgentEnvironment = (config: RepoConfig): AgentEnvironmentCommand | undefined =>
  config.agentEnvironment?.command;

export const prependAgentEnvironment = (
  command: string,
  environment: AgentEnvironmentCommand | undefined,
): string =>
  environment === undefined ? command : `${environment.map(shellQuote).join(" ")} ${command}`;

export const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
