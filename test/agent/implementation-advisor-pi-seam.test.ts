import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverAndLoadExtensions,
  ExtensionRunner,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

const extensionPath = resolve("extensions/implementation-advisor/index.ts");

const wait = async (milliseconds: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

describe("Implementation Advisor Pi event seam", () => {
  afterEach(() => {
    delete process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"];
    delete process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_CONTEXT"];
  });

  it("dispatches a real turn_end event without blocking the parent session", async () => {
    process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"] = "provider/model";
    process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_CONTEXT"] = JSON.stringify({
      changeId: "change-pi-seam",
      acceptanceContext: null,
      implementationDecisions: [],
    });
    const loaded = await discoverAndLoadExtensions([extensionPath], process.cwd(), process.cwd());
    expect(loaded.errors).toEqual([]);
    const sessionManager = SessionManager.inMemory(process.cwd());
    const notifications: string[] = [];
    const messages: unknown[] = [];
    const runner = new ExtensionRunner(
      loaded.extensions,
      loaded.runtime,
      process.cwd(),
      sessionManager,
      {} as never,
    );
    runner.bindCore(
      {
        appendEntry: (type: string, data: unknown) => sessionManager.appendCustomEntry(type, data),
        sendMessage: (message: unknown) => {
          messages.push(message);
        },
      } as never,
      {
        getModel: () => undefined,
        isIdle: () => true,
        isProjectTrusted: () => true,
        getSignal: () => undefined,
        abort: () => {},
        hasPendingMessages: () => false,
        shutdown: () => {},
        getContextUsage: () => undefined,
        compact: () => {},
        getSystemPrompt: () => "",
        getThinkingLevel: () => "off",
        getSystemPromptOptions: () => ({ cwd: process.cwd() }),
      } as never,
    );
    runner.bindCommandContext();
    runner.setUIContext({ notify: (message: string) => notifications.push(message) } as never);

    await runner.emit({ type: "session_start" } as never);
    const started = Date.now();
    await runner.emit({
      type: "turn_end",
      turnIndex: 0,
      message: { role: "assistant", content: [] },
      toolResults: [
        {
          toolName: "write",
          toolCallId: "write-pi-seam",
          input: { path: "src/pi-seam.ts" },
          content: [],
          isError: false,
        },
      ],
    } as never);
    expect(Date.now() - started).toBeLessThan(500);
    await wait(100);
    expect(notifications).toHaveLength(1);
    expect(messages).toHaveLength(0);
  });
});
