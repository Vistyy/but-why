import type { GlobalConfig } from "../contracts/globalConfig.js";
import type { RepoConfig } from "../contracts/repoConfig.js";

export type ImplementationAdvisorConfig = {
  readonly model: string;
  readonly thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined;
};

export const resolveImplementationAdvisor = (input: {
  readonly repoConfig: RepoConfig;
  readonly globalConfig: GlobalConfig;
}): ImplementationAdvisorConfig | false | undefined =>
  input.repoConfig.interactiveSession?.implementationAdvisor ??
  input.globalConfig.interactiveSession?.implementationAdvisor;
