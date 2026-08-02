import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const advisorMock = vi.hoisted(() => ({
  promptCalls: [] as string[],
  firstPromptStarted: false,
  releaseFirstPrompt: undefined as (() => void) | undefined,
  mode: "note" as "note" | "no_note" | "failure",
  appendEntries: [] as unknown[],
  notifications: [] as string[],
  messages: [] as unknown[],
  createCalls: 0,
  toolValues: [] as unknown[],
  nestedEventListener: undefined as ((event: unknown) => void) | undefined,
}));

vi.mock("@earendil-works/pi-coding-agent", async () => {
  const actual = await vi.importActual<typeof import("@earendil-works/pi-coding-agent")>(
    "@earendil-works/pi-coding-agent",
  );
  return {
    ...actual,
    ModelRuntime: {
      create: async () => ({
        getModel: () => (advisorMock.mode === "failure" ? undefined : {}),
      }),
    },
    DefaultResourceLoader: class {
      async reload(): Promise<void> {}
    },
    SessionManager: {
      continueRecent: () => ({ restoredConversation: true }),
    },
    createAgentSession: async (options: {
      customTools: Array<{
        execute: (...args: unknown[]) => Promise<unknown>;
      }>;
    }) => {
      advisorMock.createCalls += 1;
      return {
        session: {
          subscribe(listener: (event: unknown) => void): () => void {
            advisorMock.nestedEventListener = listener;
            return () => {
              if (advisorMock.nestedEventListener === listener) {
                advisorMock.nestedEventListener = undefined;
              }
            };
          },
          async prompt(prompt: string): Promise<void> {
            advisorMock.promptCalls.push(prompt);
            if (advisorMock.promptCalls.length === 1) {
              advisorMock.firstPromptStarted = true;
              await new Promise<void>((resolve) => {
                advisorMock.releaseFirstPrompt = resolve;
              });
            }
            if (advisorMock.mode === "failure") return;
            const activityBatch = prompt.match(
              /Review exactly Advisor Activity Batch ([^\n.]+)/u,
            )?.[1];
            const evidenceReference = advisorMock.nestedEventListener
              ? `${activityBatch}:investigation:investigation-read`
              : prompt.match(/"reference":"([^"]+)"/u)?.[1];
            const tool = options.customTools[0];
            if (
              tool === undefined ||
              activityBatch === undefined ||
              evidenceReference === undefined
            )
              return;
            advisorMock.nestedEventListener?.({
              type: "tool_execution_end",
              toolCallId: "investigation-read",
              toolName: "read",
              args: { path: "src/example.ts" },
              result: { content: [{ type: "text", text: "example" }] },
              isError: false,
            });
            const toolValue =
              advisorMock.mode === "no_note" || advisorMock.promptCalls.length > 1
                ? { kind: "no_note", activityBatch }
                : {
                    kind: "note",
                    ruleId: "external-mutation.reconcile-uncertain-outcome",
                    responseClass: "follow",
                    activityBatch,
                    evidence: [evidenceReference],
                    problem: "The external result is uncertain.",
                    consequence: "A retry can duplicate the mutation.",
                    correction: "Reconcile the authoritative state before retrying.",
                  };
            advisorMock.toolValues.push(toolValue);
            await tool.execute("advice", toolValue, undefined, undefined, { abort() {} } as never);
          },
        },
      };
    },
  };
});

import implementationAdvisor from "../../extensions/implementation-advisor/index.js";

type Handler = (event: never, context: never) => unknown;

const waitFor = async (condition: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Timed out waiting for advisor activity (creates=${advisorMock.createCalls}, prompts=${advisorMock.promptCalls.length}, messages=${advisorMock.messages.length}, notifications=${advisorMock.notifications.length})`,
  );
};

const turn = (turnIndex: number) =>
  ({
    type: "turn_end",
    turnIndex,
    message: { role: "assistant", content: [] },
    toolResults: [
      {
        toolName: "write",
        toolCallId: `write-${turnIndex}`,
        input: { path: `src/change-${turnIndex}.ts` },
        content: [],
        isError: false,
      },
    ],
  }) as never;

describe("Implementation Advisor extension event seam", () => {
  beforeEach(() => {
    advisorMock.promptCalls.length = 0;
    advisorMock.firstPromptStarted = false;
    advisorMock.releaseFirstPrompt = undefined;
    advisorMock.mode = "note";
    advisorMock.appendEntries.length = 0;
    advisorMock.notifications.length = 0;
    advisorMock.messages.length = 0;
    advisorMock.createCalls = 0;
    advisorMock.toolValues.length = 0;
    advisorMock.nestedEventListener = undefined;
  });

  afterEach(() => {
    delete process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"];
    delete process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_CONTEXT"];
  });

  it("does not register when a decision belongs to another Change", () => {
    process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"] = "provider/model";
    process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_CONTEXT"] = JSON.stringify({
      changeId: "change-current",
      acceptanceContext: null,
      implementationDecisions: [
        {
          id: "decision-foreign",
          changeId: "change-other",
          sequence: 1,
          recordedAt: "2026-08-02T00:00:00.000Z",
          choice: "foreign choice",
          rationale: "foreign rationale",
        },
      ],
    });
    const handlers = new Map<string, Handler>();
    implementationAdvisor({
      on(event: string, handler: Handler) {
        handlers.set(event, handler);
      },
    } as never);
    expect(handlers).toHaveLength(0);
  });

  it("does not block later turn_end events and evaluates the complete pending batch", async () => {
    process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"] = "provider/model";
    process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_CONTEXT"] = JSON.stringify({
      changeId: "change-1",
      acceptanceContext: null,
      implementationDecisions: [],
    });
    const handlers = new Map<string, Handler>();
    implementationAdvisor({
      on(event: string, handler: Handler) {
        handlers.set(event, handler);
      },
      appendEntry(_type: string, data: unknown) {
        advisorMock.appendEntries.push(data);
      },
      sendMessage(message: unknown) {
        advisorMock.messages.push(message);
      },
    } as never);
    const context = {
      cwd: process.cwd(),
      sessionManager: {
        getSessionId: () => "parent-session",
        getBranch: () => [],
      },
      isIdle: () => false,
      ui: {
        notify(message: string) {
          advisorMock.notifications.push(message);
        },
      },
    } as never;

    handlers.get("session_start")?.({} as never, context);
    handlers.get("turn_end")?.(turn(1), context);
    await waitFor(() => advisorMock.firstPromptStarted);
    handlers.get("turn_end")?.(turn(2), context);
    expect(advisorMock.promptCalls).toHaveLength(1);

    advisorMock.releaseFirstPrompt?.();
    await waitFor(() => advisorMock.promptCalls.length >= 2 && advisorMock.messages.length >= 1);
    expect(advisorMock.promptCalls[1]).toContain("Advisor Activity Batch turn:2");
    expect(advisorMock.appendEntries).toHaveLength(1);
    expect(advisorMock.messages[0]).toMatchObject({
      details: { activityBatch: "turn:1" },
    });
  });

  it("fails open across model failures, persistence failures, and restoration failures", async () => {
    process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"] = "provider/model";
    process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_CONTEXT"] = JSON.stringify({
      changeId: "change-2",
      acceptanceContext: null,
      implementationDecisions: [],
    });
    advisorMock.mode = "failure";
    const handlers = new Map<string, Handler>();
    implementationAdvisor({
      on(event: string, handler: Handler) {
        handlers.set(event, handler);
      },
      appendEntry() {
        throw new Error("persistence unavailable");
      },
    } as never);
    const context = {
      cwd: process.cwd(),
      sessionManager: {
        getSessionId: () => {
          throw new Error("session unavailable");
        },
        getBranch: () => [],
      },
      isIdle: () => true,
      ui: {
        notify(message: string) {
          advisorMock.notifications.push(message);
        },
      },
    } as never;

    expect(() => handlers.get("session_start")?.({} as never, context)).not.toThrow();
    for (let turnIndex = 1; turnIndex <= 3; turnIndex += 1) {
      handlers.get("turn_end")?.(turn(turnIndex), context);
    }
    await waitFor(() => advisorMock.notifications.length === 1);
    expect(advisorMock.notifications).toHaveLength(1);
  });
});
