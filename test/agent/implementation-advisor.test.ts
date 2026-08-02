import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodeGlobalConfig, type GlobalConfig } from "../../src/contracts/globalConfig.js";
import { decodeRepoConfig, type RepoConfig } from "../../src/contracts/repoConfig.js";
import { resolveImplementationAdvisor } from "../../src/change/implementationAdvisorConfig.js";
import { implementationAdvisorRules } from "../../extensions/implementation-advisor/rules.js";

const right = <T>(result: unknown): T => {
  if (!Either.isRight(result as never)) throw new Error("Expected a valid test configuration");
  return (result as { readonly right: T }).right;
};

describe("Implementation Advisor", () => {
  it("resolves repo disablement and configured advisor atomically over Global Config", () => {
    const global = right<GlobalConfig>(
      decodeGlobalConfig({
        interactiveSession: { implementationAdvisor: { model: "provider/global" } },
      }),
    );
    const repo = right<RepoConfig>(
      decodeRepoConfig({ taskPrefix: "BY", interactiveSession: { implementationAdvisor: false } }),
    );
    expect(resolveImplementationAdvisor({ repoConfig: repo, globalConfig: global })).toBe(false);
    const enabledRepo = right<RepoConfig>(
      decodeRepoConfig({
        taskPrefix: "BY",
        interactiveSession: { implementationAdvisor: { model: "provider/repo", thinking: "low" } },
      }),
    );
    expect(resolveImplementationAdvisor({ repoConfig: enabledRepo, globalConfig: global })).toEqual(
      { model: "provider/repo", thinking: "low" },
    );
  });

  it("keeps the four typed rules in priority order", () => {
    expect(implementationAdvisorRules.map((rule) => rule.id)).toEqual([
      "authority.explicit-conflict",
      "external-mutation.reconcile-before-retry",
      "current-system.remove-retired-concept",
      "verification.proportional-evidence",
    ]);
    expect(implementationAdvisorRules.every((rule) => rule.instruction.includes("Advise"))).toBe(
      true,
    );
  });
});
