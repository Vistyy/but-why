import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodeGlobalConfig, type GlobalConfig } from "../../src/contracts/globalConfig.js";
import { decodeRepoConfig, type RepoConfig } from "../../src/contracts/repoConfig.js";
import { resolveImplementationAdvisor } from "../../src/change/implementationAdvisorConfig.js";
import { openHerdrInteractiveSessionHost } from "../../src/change/herdrInteractiveSessionHost.js";
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

  it("loads the optional trusted extension only for configured Implementer sessions", async () => {
    const commands: string[] = [];
    const execute = async (args: readonly string[]) => {
      if (args[0] === "pane") commands.push(args.join(" "));
      if (args[0] === "agent" && args[1] === "list")
        return { ok: true as const, stdout: '{"result":{"type":"agent_list","agents":[]}}' };
      if (args[0] === "worktree")
        return {
          ok: true as const,
          stdout:
            '{"result":{"type":"worktree_opened","workspace":{"workspace_id":"w"},"root_pane":{"pane_id":"p"},"already_open":false}}',
        };
      if (args[0] === "agent" && args[1] === "rename")
        return {
          ok: true as const,
          stdout: '{"result":{"agent":{"name":"but-why-c","cwd":"/w","pane_id":"p"}}}',
        };
      return { ok: true as const, stdout: "{}" };
    };
    await openHerdrInteractiveSessionHost(execute).launch({
      changeId: "c",
      repositoryPath: "/r",
      worktreePath: "/w",
      initialPrompt: "",
      implementationAdvisor: { model: "provider/model" },
    });
    expect(commands[0]).toContain("implementation-advisor/index.ts");
    expect(commands[0]).toContain("BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL");
  });
});
