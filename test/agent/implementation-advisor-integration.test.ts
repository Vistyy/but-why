import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const advisorMock = vi.hoisted(() => ({
  promptCalls: [] as string[],
  firstPromptStarted: false,
  holdFirstPrompt: false,
  secondPromptNoNote: false,
  releaseFirstPrompt: undefined as (() => void) | undefined,
  mode: "note" as "note" | "no_note" | "failure" | "malformed",
  appendEntries: [] as unknown[],
  notifications: [] as string[],
  messages: [] as unknown[],
  deliveryOptions: [] as unknown[],
  sendMessageFailure: false,
  createCalls: 0,
  toolValues: [] as unknown[],
  nestedEventListener: undefined as ((event: unknown) => void) | undefined,
  sessionManager: undefined as unknown,
}));

vi.mock("@earendil-works/pi-coding-agent", async () => {
  const actual = await vi.importActual<typeof import("@earendil-works/pi-coding-agent")>(
    "@earendil-works/pi-coding-agent",
  );
  const actualContinueRecent = actual.SessionManager.continueRecent.bind(actual.SessionManager);
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
    SessionManager: Object.assign(actual.SessionManager, {
      continueRecent: (...args: Parameters<typeof actual.SessionManager.continueRecent>) =>
        advisorMock.sessionManager ?? actualContinueRecent(...args),
    }),
    createAgentSession: async (options: {
      customTools: Array<{
        execute: (...args: unknown[]) => Promise<unknown>;
      }>;
    }) => {
      advisorMock.createCalls += 1;
      return {
        session: {
          sessionManager: advisorMock.sessionManager,
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
            if (advisorMock.holdFirstPrompt && advisorMock.promptCalls.length === 1) {
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
              advisorMock.mode === "malformed"
                ? { kind: "note", activityBatch }
                : advisorMock.mode === "no_note" ||
                    (advisorMock.secondPromptNoNote && advisorMock.promptCalls.length > 1)
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
    advisorMock.holdFirstPrompt = false;
    advisorMock.secondPromptNoNote = false;
    advisorMock.releaseFirstPrompt = undefined;
    advisorMock.mode = "note";
    advisorMock.appendEntries.length = 0;
    advisorMock.notifications.length = 0;
    advisorMock.messages.length = 0;
    advisorMock.deliveryOptions.length = 0;
    advisorMock.sendMessageFailure = false;
    advisorMock.createCalls = 0;
    advisorMock.toolValues.length = 0;
    advisorMock.nestedEventListener = undefined;
    advisorMock.sessionManager = undefined;
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

  it("opens the interactive TUI viewer for the current advisor session", async () => {
    process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"] = "provider/model";
    process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_CONTEXT"] = JSON.stringify({
      changeId: "change-viewer",
      acceptanceContext: null,
      implementationDecisions: [],
    });
    const { SessionManager } = await import("@earendil-works/pi-coding-agent");
    const parent = SessionManager.inMemory(process.cwd());
    parent.appendCustomEntry("but-why.implementation-advisor.state", {
      fingerprints: [],
      failures: 1,
      disabled: false,
      latestRejectionReason: "Advisor result rejected: host evidence was incomplete.",
    });
    const nested = SessionManager.inMemory(process.cwd());
    nested.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Persisted advisor response" }],
      timestamp: Date.now(),
    } as never);
    advisorMock.sessionManager = nested;

    const commands = new Map<string, (args: never, context: never) => Promise<void>>();
    let requestRenderCount = 0;
    let colors: string[] = [];
    let closed = false;
    let rendered: string[] = [];
    implementationAdvisor({
      on() {},
      registerCommand(
        name: string,
        command: { handler: (args: never, context: never) => Promise<void> },
      ) {
        commands.set(name, command.handler);
      },
      appendEntry() {},
    } as never);
    const context = {
      mode: "tui",
      cwd: process.cwd(),
      sessionManager: parent,
      isIdle: () => true,
      ui: {
        notify() {},
        async custom(
          factory: (
            tui: unknown,
            theme: unknown,
            keybindings: unknown,
            done: (result: undefined) => void,
          ) => {
            render(width: number): string[];
            handleInput(data: string): void;
            dispose(): void;
          },
          options: unknown,
        ): Promise<undefined> {
          expect(options).toMatchObject({ overlay: true });
          const beforeClose = nested.getBranch().length;
          const component = factory(
            {
              terminal: { rows: 30 },
              requestRender: () => {
                requestRenderCount += 1;
              },
            },
            {
              fg: (color: string, text: string) => {
                colors.push(color);
                return text;
              },
              bold: (text: string) => text,
            },
            {},
            () => {
              closed = true;
            },
          );
          rendered = component.render(60);
          advisorMock.nestedEventListener?.({
            type: "message_start",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Live advisor response" }],
            },
          });
          advisorMock.nestedEventListener?.({
            type: "tool_execution_start",
            toolCallId: "read-live",
            toolName: "read",
            args: { path: "src/example.ts" },
          });
          rendered = component.render(60);
          component.handleInput("escape");
          component.dispose();
          expect(nested.getBranch()).toHaveLength(beforeClose);
          return undefined;
        },
      },
    } as never;

    await commands.get("advisor")?.({} as never, context as never);
    expect(rendered.join("\\n")).toContain("Persisted advisor response");
    expect(rendered.join("\\n")).toContain("host evidence was incomplete");
    expect(rendered.join("\\n")).toContain("Live advisor response");
    expect(rendered.join("\\n")).toContain("tool [running]: read");
    expect(colors).toEqual(expect.arrayContaining(["accent", "warning", "error", "borderAccent"]));
    expect(rendered.every((line) => line.length <= 60)).toBe(true);
    expect(requestRenderCount).toBeGreaterThan(1);
    expect(closed).toBe(true);
    expect(advisorMock.sessionManager).toBe(nested);
  });

  it("does not block later turn_end events and evaluates the complete pending batch", async () => {
    process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"] = "provider/model";
    process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_CONTEXT"] = JSON.stringify({
      changeId: "change-1",
      acceptanceContext: null,
      implementationDecisions: [],
    });
    advisorMock.holdFirstPrompt = true;
    advisorMock.secondPromptNoNote = true;
    const handlers = new Map<string, Handler>();
    implementationAdvisor({
      on(event: string, handler: Handler) {
        handlers.set(event, handler);
      },
      appendEntry(_type: string, data: unknown) {
        advisorMock.appendEntries.push(data);
      },
      sendMessage(message: unknown, options: unknown) {
        if (advisorMock.sendMessageFailure) throw new Error("delivery unavailable");
        advisorMock.messages.push(message);
        advisorMock.deliveryOptions.push(options);
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
    expect(advisorMock.deliveryOptions[0]).toEqual({
      triggerTurn: false,
      deliverAs: "followUp",
    });
  });

  it("delivers idle advice on the next turn without triggering a model turn", async () => {
    process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"] = "provider/model";
    process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_CONTEXT"] = JSON.stringify({
      changeId: "change-idle",
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
      sendMessage(message: unknown, options: unknown) {
        advisorMock.messages.push(message);
        advisorMock.deliveryOptions.push(options);
      },
    } as never);
    const context = {
      cwd: process.cwd(),
      sessionManager: { getSessionId: () => "idle-session", getBranch: () => [] },
      isIdle: () => true,
      ui: {
        notify(message: string) {
          advisorMock.notifications.push(message);
        },
      },
    } as never;
    handlers.get("session_start")?.({} as never, context);
    handlers.get("turn_end")?.(turn(1), context);
    await waitFor(() => advisorMock.messages.length === 1);
    expect(advisorMock.deliveryOptions[0]).toEqual({
      triggerTurn: false,
      deliverAs: "nextTurn",
    });
  });

  it("fails open for malformed output, persistence failures, and delivery failures", async () => {
    process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"] = "provider/model";
    process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_CONTEXT"] = JSON.stringify({
      changeId: "change-failures",
      acceptanceContext: null,
      implementationDecisions: [],
    });
    advisorMock.mode = "malformed";
    const malformedHandlers = new Map<string, Handler>();
    implementationAdvisor({
      on(event: string, handler: Handler) {
        malformedHandlers.set(event, handler);
      },
      appendEntry(_type: string, data: unknown) {
        advisorMock.appendEntries.push(data);
      },
      sendMessage(message: unknown, options: unknown) {
        advisorMock.messages.push(message);
        advisorMock.deliveryOptions.push(options);
      },
    } as never);
    const context = {
      cwd: process.cwd(),
      sessionManager: { getSessionId: () => "failure-session", getBranch: () => [] },
      isIdle: () => true,
      ui: {
        notify(message: string) {
          advisorMock.notifications.push(message);
        },
      },
    } as never;
    malformedHandlers.get("turn_end")?.(turn(1), context);
    await waitFor(() => advisorMock.notifications.length === 1);
    expect(advisorMock.messages).toHaveLength(0);

    advisorMock.mode = "note";
    const persistenceHandlers = new Map<string, Handler>();
    implementationAdvisor({
      on(event: string, handler: Handler) {
        persistenceHandlers.set(event, handler);
      },
      appendEntry() {
        throw new Error("persistence unavailable");
      },
      sendMessage(message: unknown, options: unknown) {
        advisorMock.messages.push(message);
        advisorMock.deliveryOptions.push(options);
      },
    } as never);
    persistenceHandlers.get("turn_end")?.(turn(2), context);
    await waitFor(() => advisorMock.messages.length === 1);
    expect(advisorMock.messages[0]).toMatchObject({ details: { activityBatch: "turn:2" } });

    advisorMock.sendMessageFailure = true;
    const deliveryHandlers = new Map<string, Handler>();
    implementationAdvisor({
      on(event: string, handler: Handler) {
        deliveryHandlers.set(event, handler);
      },
      appendEntry(_type: string, data: unknown) {
        advisorMock.appendEntries.push(data);
      },
      sendMessage(message: unknown, options: unknown) {
        if (advisorMock.sendMessageFailure) throw new Error("delivery unavailable");
        advisorMock.messages.push(message);
        advisorMock.deliveryOptions.push(options);
      },
    } as never);
    deliveryHandlers.get("turn_end")?.(turn(3), context);
    await waitFor(() => advisorMock.notifications.length === 2);
    expect(advisorMock.messages).toHaveLength(1);
  });

  it("disables after three failures and restores the disabled state", async () => {
    process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"] = "provider/model";
    process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_CONTEXT"] = JSON.stringify({
      changeId: "change-disabled",
      acceptanceContext: null,
      implementationDecisions: [],
    });
    advisorMock.mode = "failure";
    const entries: unknown[] = [];
    const handlers = new Map<string, Handler>();
    implementationAdvisor({
      on(event: string, handler: Handler) {
        handlers.set(event, handler);
      },
      appendEntry(_type: string, data: unknown) {
        entries.push(data);
      },
    } as never);
    const context = {
      cwd: process.cwd(),
      sessionManager: { getSessionId: () => "disabled-session", getBranch: () => [] },
      isIdle: () => true,
      ui: {
        notify(message: string) {
          advisorMock.notifications.push(message);
        },
      },
    } as never;
    for (let turnIndex = 1; turnIndex <= 3; turnIndex += 1) {
      handlers.get("turn_end")?.(turn(turnIndex), context);
      await waitFor(() => entries.length === turnIndex);
    }
    expect(advisorMock.notifications).toHaveLength(1);

    const restoredEntries: unknown[] = [];
    const restoredHandlers = new Map<string, Handler>();
    implementationAdvisor({
      on(event: string, handler: Handler) {
        restoredHandlers.set(event, handler);
      },
      appendEntry(_type: string, data: unknown) {
        restoredEntries.push(data);
      },
    } as never);
    const restoredContext = {
      cwd: process.cwd(),
      sessionManager: {
        getSessionId: () => "disabled-session",
        getBranch: () => [
          {
            type: "custom",
            customType: "but-why.implementation-advisor.state",
            data: { fingerprints: [], failures: 3, disabled: true },
          },
        ],
      },
      isIdle: () => true,
      ui: { notify() {} },
    } as never;
    restoredHandlers.get("session_start")?.({} as never, restoredContext);
    restoredHandlers.get("turn_end")?.(turn(4), restoredContext);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(advisorMock.createCalls).toBe(0);
    expect(restoredEntries).toHaveLength(0);
  });

  it("resets consecutive failures after a successful no-note evaluation", async () => {
    process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"] = "provider/model";
    process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_CONTEXT"] = JSON.stringify({
      changeId: "change-reset",
      acceptanceContext: null,
      implementationDecisions: [],
    });
    advisorMock.mode = "failure";
    const entries: unknown[] = [];
    const handlers = new Map<string, Handler>();
    implementationAdvisor({
      on(event: string, handler: Handler) {
        handlers.set(event, handler);
      },
      appendEntry(_type: string, data: unknown) {
        entries.push(data);
      },
    } as never);
    const context = {
      cwd: process.cwd(),
      sessionManager: { getSessionId: () => "reset-session", getBranch: () => [] },
      isIdle: () => true,
      ui: {
        notify(message: string) {
          advisorMock.notifications.push(message);
        },
      },
    } as never;
    handlers.get("turn_end")?.(turn(1), context);
    await waitFor(() => advisorMock.notifications.length === 1);
    advisorMock.mode = "no_note";
    handlers.get("turn_end")?.(turn(2), context);
    await waitFor(() => entries.some((entry) => (entry as { failures?: number }).failures === 0));
    expect(advisorMock.notifications).toHaveLength(1);
  });

  it("restores duplicate fingerprints and failure counts from persisted Pi session state", async () => {
    process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"] = "provider/model";
    process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_CONTEXT"] = JSON.stringify({
      changeId: "change-persisted",
      acceptanceContext: null,
      implementationDecisions: [],
    });
    const sessionDirectory = mkdtempSync(join(tmpdir(), "by99-advisor-session-"));
    try {
      const { SessionManager } = await import("@earendil-works/pi-coding-agent");
      const session = SessionManager.create(process.cwd(), sessionDirectory);
      const firstMessage = session.appendMessage({
        role: "user",
        content: [{ type: "text", text: "before compaction" }],
        timestamp: Date.now(),
      });
      session.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "implementation history" }],
        timestamp: Date.now(),
      } as never);
      session.appendCompaction("Compacted implementation history.", firstMessage, 10);
      advisorMock.sessionManager = session;
      const firstEntries: unknown[] = [];
      const firstHandlers = new Map<string, Handler>();
      implementationAdvisor({
        on(event: string, handler: Handler) {
          firstHandlers.set(event, handler);
        },
        appendEntry(type: string, data: unknown) {
          session.appendCustomEntry(type, data);
          firstEntries.push(data);
        },
        sendMessage(message: unknown) {
          advisorMock.messages.push(message);
        },
      } as never);
      const context = {
        cwd: process.cwd(),
        sessionManager: session,
        isIdle: () => true,
        ui: { notify() {} },
      } as never;
      firstHandlers.get("session_start")?.({} as never, context);
      firstHandlers.get("turn_end")?.(turn(1), context);
      await waitFor(() => advisorMock.messages.length === 1);
      expect(firstEntries).toHaveLength(1);
      expect(session.getBranch()).toContainEqual(
        expect.objectContaining({ customType: "but-why.implementation-advisor.state" }),
      );
      expect(session.getBranch()).toContainEqual(expect.objectContaining({ type: "compaction" }));

      advisorMock.sessionManager = undefined;
      const reopened = SessionManager.continueRecent(process.cwd(), sessionDirectory);
      advisorMock.sessionManager = reopened;
      const duplicateEntries: unknown[] = [];
      const duplicateHandlers = new Map<string, Handler>();
      implementationAdvisor({
        on(event: string, handler: Handler) {
          duplicateHandlers.set(event, handler);
        },
        appendEntry(type: string, data: unknown) {
          reopened.appendCustomEntry(type, data);
          duplicateEntries.push(data);
        },
        sendMessage(message: unknown) {
          advisorMock.messages.push(message);
        },
      } as never);
      const restoredContext = {
        cwd: process.cwd(),
        sessionManager: reopened,
        isIdle: () => true,
        ui: { notify() {} },
      } as never;
      duplicateHandlers.get("session_start")?.({} as never, restoredContext);
      duplicateHandlers.get("turn_end")?.(turn(1), restoredContext);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(advisorMock.messages).toHaveLength(1);
      expect(duplicateEntries).toHaveLength(0);

      reopened.appendCustomEntry("but-why.implementation-advisor.state", {
        fingerprints: [],
        failures: 2,
        disabled: false,
      });
      advisorMock.mode = "failure";
      const failureEntries: unknown[] = [];
      const failureHandlers = new Map<string, Handler>();
      implementationAdvisor({
        on(event: string, handler: Handler) {
          failureHandlers.set(event, handler);
        },
        appendEntry(type: string, data: unknown) {
          reopened.appendCustomEntry(type, data);
          failureEntries.push(data);
        },
      } as never);
      failureHandlers.get("session_start")?.({} as never, restoredContext);
      failureHandlers.get("turn_end")?.(turn(2), restoredContext);
      await waitFor(() => failureEntries.length === 1);
      expect(failureEntries[0]).toMatchObject({ failures: 3, disabled: true });
    } finally {
      advisorMock.mode = "note";
      advisorMock.sessionManager = undefined;
      rmSync(sessionDirectory, { recursive: true, force: true });
    }
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
