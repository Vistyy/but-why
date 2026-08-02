import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodeGlobalConfig, type GlobalConfig } from "../../src/contracts/globalConfig.js";
import { decodeRepoConfig, type RepoConfig } from "../../src/contracts/repoConfig.js";
import { resolveImplementationAdvisor } from "../../src/change/implementationAdvisorConfig.js";
import { implementationAdvisorRules } from "../../extensions/implementation-advisor/rules.js";
import implementationAdvisor from "../../extensions/implementation-advisor/index.js";
import {
  implementationAdvisorToolNames,
  shouldEvaluateActivity,
  validateAdvisorNote,
  advisorDisabledAfterFailures,
  createAdvisorActivityScheduler,
  type Evidence,
} from "../../extensions/implementation-advisor/index.js";

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

  it("schedules qualifying activity and ignores discussion and ordinary reads", () => {
    expect(shouldEvaluateActivity("write", {})).toBe(true);
    expect(shouldEvaluateActivity("read", { path: "README.md" })).toBe(false);
    expect(shouldEvaluateActivity("read", { path: "docs/architecture.md" })).toBe(true);
  });

  it("enforces the fixed tool allowlist and structured output binding", () => {
    const evidence: Evidence[] = [
      { activity: "write", reference: "write:1", input: {}, result: [], failed: false },
    ];
    expect(implementationAdvisorToolNames).toEqual(["read", "grep", "find", "ls"]);
    expect(
      validateAdvisorNote(
        {
          ruleId: "authority.explicit-conflict",
          message: "Review.",
          evidence: ["read:1"],
          activityBatch: 2,
        },
        2,
        evidence,
      ),
    ).toBeUndefined();
    expect(
      validateAdvisorNote(
        {
          ruleId: "authority.explicit-conflict",
          message: "Review.",
          evidence: ["write:1"],
          activityBatch: 2,
        },
        2,
        evidence,
      ),
    ).toMatchObject({ activityBatch: 2 });
  });

  it("keeps delivery non-waking and continuation-owned", () => {
    expect({ triggerTurn: false, owner: "continue-change" }).toEqual({
      triggerTurn: false,
      owner: "continue-change",
    });
  });

  it("coalesces later qualifying deltas and evaluates them after the active batch", async () => {
    const batches: Array<readonly string[]> = [];
    const delivered: number[] = [];
    let release: (() => void) | undefined;
    const scheduler = createAdvisorActivityScheduler<string>(
      async (_batch, activity) => {
        batches.push(activity);
        if (batches.length === 1)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
      },
      (batch) => delivered.push(batch),
    );
    scheduler.add("first");
    const first = scheduler.settle();
    scheduler.add("second");
    scheduler.add("third");
    release?.();
    await first;
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(batches).toEqual([["first"], ["second", "third"]]);
    expect(delivered).toEqual([1, 2]);
  });

  it("disables after three failures and restores the disabled state", () => {
    expect(advisorDisabledAfterFailures(2)).toBe(false);
    expect(advisorDisabledAfterFailures(3)).toBe(true);
    expect(advisorDisabledAfterFailures(4)).toBe(true);
  });

  it("runs scheduler failure injection through Pi event handlers without waking the host", async () => {
    const previous = process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"];
    process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"] = "missing/model";
    const handlers = new Map<string, (event: unknown, context: unknown) => unknown>();
    const entries: unknown[] = [];
    const sent: unknown[] = [];
    implementationAdvisor({
      on(event: string, handler: (event: unknown, context: unknown) => unknown) {
        handlers.set(event, handler);
      },
      appendEntry(_type: string, data: unknown) {
        entries.push(data);
      },
      sendMessage(message: unknown) {
        sent.push(message);
      },
    } as never);
    const context = {
      sessionManager: { getBranch: () => [] },
      isIdle: () => true,
      ui: { notify() {} },
    };
    await handlers.get("tool_result")?.(
      {
        type: "tool_result",
        toolName: "write",
        toolCallId: "write:1",
        input: { path: "src/a.ts" },
        content: [],
        isError: false,
      },
      context,
    );
    await handlers.get("agent_settled")?.({ type: "agent_settled" }, context);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(entries).toHaveLength(1);
    expect(sent).toHaveLength(0);
    if (previous === undefined) delete process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"];
    else process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"] = previous;
  });
});
