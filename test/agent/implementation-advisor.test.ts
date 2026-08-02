import { Value } from "typebox/value";
import { Either } from "effect";
import { describe, expect, it, vi } from "vitest";

const advisorMock = vi.hoisted(() => ({
  mode: "valid" as "valid" | "invalid",
  sessionRestored: false,
}));
vi.mock("@earendil-works/pi-coding-agent", async () => {
  const actual = await vi.importActual<typeof import("@earendil-works/pi-coding-agent")>(
    "@earendil-works/pi-coding-agent",
  );
  return {
    ...actual,
    ModelRuntime: {
      create: async () => ({
        getModel: (provider: string, model: string) =>
          provider + "/" + model === "missing/model" ? undefined : {},
      }),
    },
    DefaultResourceLoader: class {
      async reload(): Promise<void> {}
    },
    SessionManager: {
      continueRecent: () => {
        advisorMock.sessionRestored = true;
        return {};
      },
    },
    createAgentSession: async (options: {
      customTools: Array<{ execute: (...args: never[]) => Promise<unknown> }>;
    }) => ({
      session: {
        async prompt(prompt: string): Promise<void> {
          const batch = Number(prompt.match(/Review activity batch (\d+)/u)?.[1] ?? 0);
          const evidence = JSON.parse(
            prompt.match(/Evidence, including inputs and results: (\[.*?\])\. Rules/u)?.[1] ?? "[]",
          ) as Array<{ reference: string }>;
          const tool = options.customTools[0];
          if (tool === undefined) return;
          await (tool.execute as (...args: unknown[]) => Promise<unknown>)(
            "id",
            advisorMock.mode === "valid"
              ? {
                  ruleId: "verification.proportional-evidence",
                  message: "Review.",
                  evidence: evidence.slice(0, 1).map((item) => item.reference),
                  activityBatch: batch,
                }
              : { ruleId: "unknown", message: "", evidence: [], activityBatch: batch },
            undefined,
            undefined,
            undefined,
            { abort() {} } as never,
          );
        },
      },
    }),
  };
});
import { decodeGlobalConfig, type GlobalConfig } from "../../src/contracts/globalConfig.js";
import { decodeRepoConfig, type RepoConfig } from "../../src/contracts/repoConfig.js";
import { resolveImplementationAdvisor } from "../../src/change/implementationAdvisorConfig.js";
import { implementationAdvisorRules } from "../../extensions/implementation-advisor/rules.js";
import implementationAdvisor from "../../extensions/implementation-advisor/index.js";
import {
  implementationAdvisorToolNames,
  implementationAdvisorNoteSchema,
  deliverAdvisorAdvice,
  shouldEvaluateActivity,
  validateAdvisorNote,
  advisorDisabledAfterFailures,
  nextAdvisorFailures,
  shouldEmit,
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
      Value.Check(implementationAdvisorNoteSchema, {
        ruleId: "authority.explicit-conflict",
        message: "Review.",
        evidence: ["write:1"],
        activityBatch: 2,
      }),
    ).toBe(true);
    expect(
      Value.Check(implementationAdvisorNoteSchema, {
        ruleId: "authority.explicit-conflict",
        message: "Review.",
        evidence: [],
        activityBatch: "2",
      }),
    ).toBe(false);
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

  it("delivers advice without waking the host", () => {
    const sent: unknown[] = [];
    deliverAdvisorAdvice((message, options) => sent.push({ message, options }), false, {
      ruleId: "verification.proportional-evidence",
      message: "Review.",
      evidence: ["write:1"],
      activityBatch: 2,
    });
    expect(sent[0]).toMatchObject({ options: { triggerTurn: false, deliverAs: "followUp" } });
    expect(sent[0]).toMatchObject({ message: { details: { activityBatch: 2 } } });
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

  it("disables after three failures and resets after success", () => {
    expect(advisorDisabledAfterFailures(2)).toBe(false);
    expect(advisorDisabledAfterFailures(3)).toBe(true);
    expect(nextAdvisorFailures(nextAdvisorFailures(2, "failure"), "success")).toBe(0);
    expect(nextAdvisorFailures(0, "failure")).toBe(1);
    const note = {
      ruleId: "verification.proportional-evidence" as const,
      message: "Review.",
      evidence: ["write:1"],
      activityBatch: 2,
    };
    expect(shouldEmit(note, new Map())).toBe(true);
    expect(
      shouldEmit(
        note,
        new Map([
          ["verification.proportional-evidence:a", 3],
          ["verification.proportional-evidence:b", 1],
        ]),
      ),
    ).toBe(false);
  });

  it("evaluates through nested Pi, delivers to the host, and terminates invalid advice", async () => {
    advisorMock.mode = "valid";
    const previousModel = process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"];
    process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"] = "provider/model";
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
      sendMessage(message: unknown, options: unknown) {
        sent.push({ message, options });
      },
    } as never);
    let idle = false;
    const context = {
      cwd: ".",
      sessionManager: { getBranch: () => [] },
      isIdle: () => idle,
      ui: { notify() {} },
    };
    advisorMock.mode = "valid";
    await handlers.get("tool_result")?.(
      {
        toolName: "write",
        toolCallId: "write:success",
        input: { path: "src/a.ts" },
        content: [],
        isError: false,
      },
      context,
    );
    await handlers.get("agent_settled")?.({}, context);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toHaveLength(1);
    expect(advisorMock.sessionRestored).toBe(true);
    expect(sent[0]).toMatchObject({ options: { triggerTurn: false, deliverAs: "followUp" } });
    idle = true;
    await handlers.get("tool_result")?.(
      {
        toolName: "write",
        toolCallId: "write:idle",
        input: { path: "src/c.ts" },
        content: [],
        isError: false,
      },
      context,
    );
    await handlers.get("agent_settled")?.({}, context);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ options: { triggerTurn: false, deliverAs: "nextTurn" } });
    advisorMock.mode = "invalid";
    await handlers.get("tool_result")?.(
      {
        toolName: "write",
        toolCallId: "write:invalid",
        input: { path: "src/b.ts" },
        content: [],
        isError: false,
      },
      context,
    );
    await handlers.get("agent_settled")?.({}, context);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toHaveLength(2);
    expect(entries.at(-1)).toMatchObject({ outcome: "failure", failures: 1 });
    if (previousModel === undefined) delete process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"];
    else process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"] = previousModel;
  });

  it("records three injected failures, disables, and restores disabled state from the ledger", async () => {
    advisorMock.mode = "valid";
    const previous = process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"];
    process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"] = "missing/model";
    const handlers = new Map<string, (event: unknown, context: unknown) => unknown>();
    const entries: unknown[] = [];
    implementationAdvisor({
      on(event: string, handler: (event: unknown, context: unknown) => unknown) {
        handlers.set(event, handler);
      },
      appendEntry(_type: string, data: unknown) {
        entries.push(data);
      },
    } as never);
    const context = {
      sessionManager: { getBranch: () => [] },
      isIdle: () => true,
      ui: { notify() {} },
    };
    for (let index = 1; index <= 3; index += 1) {
      await handlers.get("tool_result")?.(
        {
          toolName: index === 1 ? "read" : "write",
          toolCallId: `${index === 1 ? "read" : "write"}:${index}`,
          input: { path: index === 1 ? "README.md" : "src/a.ts" },
          content: [],
          isError: index === 1,
        },
        context,
      );
      await handlers.get("agent_settled")?.({ type: "agent_settled" }, context);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(entries).toHaveLength(3);
    await handlers.get("tool_result")?.(
      {
        toolName: "write",
        toolCallId: "write:4",
        input: { path: "src/a.ts" },
        content: [],
        isError: false,
      },
      context,
    );
    await handlers.get("agent_settled")?.({ type: "agent_settled" }, context);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(entries).toHaveLength(3);

    const restoredEntries: unknown[] = [];
    const restoredHandlers = new Map<string, (event: unknown, context: unknown) => unknown>();
    implementationAdvisor({
      on(event: string, handler: (event: unknown, context: unknown) => unknown) {
        restoredHandlers.set(event, handler);
      },
      appendEntry(_type: string, data: unknown) {
        restoredEntries.push(data);
      },
    } as never);
    const restoredContext = {
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: "but-why.implementation-advisor.ledger",
            data: {
              rule: "none",
              batch: 1,
              evidenceFingerprint: "a",
              outcome: "failure",
              failures: 3,
              timestamp: "now",
            },
          },
        ],
      },
      isIdle: () => true,
      ui: { notify() {} },
    };
    await restoredHandlers.get("session_start")?.({}, restoredContext);
    await restoredHandlers.get("tool_result")?.(
      {
        toolName: "write",
        toolCallId: "write:restored",
        input: { path: "src/a.ts" },
        content: [],
        isError: false,
      },
      restoredContext,
    );
    await restoredHandlers.get("agent_settled")?.({}, restoredContext);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(restoredEntries).toHaveLength(0);
    if (previous === undefined) delete process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"];
    else process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"] = previous;
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
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(entries).toHaveLength(1);
    expect(sent).toHaveLength(0);
    if (previous === undefined) delete process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"];
    else process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"] = previous;
  });
});
