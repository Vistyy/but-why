import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import continueChange from "../../extensions/continue-change.js";

const changeId = "de32d32a-ecd8-46b4-b2d8-5a08d2128869";

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  change: { state: "open", closeReason: null },
  currentCandidate: null,
  currentValidationRun: null,
  findingCount: 0,
  toolingFailureCount: 0,
  pullRequest: null,
  ...overrides,
});

type TestSnapshot = ReturnType<typeof snapshot>;
type EventHandler = (event: unknown, context: ExtensionContext) => unknown;
type CommandHandler = (args: string, context: ExtensionContext) => unknown;

const createHarness = () => {
  const handlers = new Map<string, EventHandler>();
  const commands = new Map<string, CommandHandler>();
  const entries: SessionEntry[] = [
    {
      type: "message",
      id: "user-1",
      parentId: null,
      timestamp: new Date().toISOString(),
      message: {
        role: "user",
        content: `Change identity: ${changeId}.`,
        timestamp: Date.now(),
      },
    },
  ];
  const sent: string[] = [];
  const notifications: string[] = [];
  const widgets: Array<{ readonly name: string; readonly value: unknown }> = [];
  let currentSnapshot: TestSnapshot = snapshot();
  let inspectionFails = false;
  let directByUnavailable = false;
  const execCalls: Array<{ readonly command: string; readonly args: readonly string[] }> = [];
  const api = {
    on(event: string, handler: EventHandler) {
      handlers.set(event, handler);
    },
    registerCommand(name: string, options: { handler: CommandHandler }) {
      commands.set(name, options.handler);
    },
    appendEntry(_type: string, data: unknown) {
      entries.push({
        type: "custom",
        id: `custom-${entries.length}`,
        parentId: entries.at(-1)?.id ?? null,
        timestamp: new Date().toISOString(),
        customType: "but-why-change-continuation",
        data,
      });
    },
    sendUserMessage(message: string) {
      sent.push(message);
    },
    async exec(command: string, args: string[]) {
      execCalls.push({ command, args });
      if (command === "by" && inspectionFails)
        return { stdout: "", stderr: "", code: 1, killed: true };
      if (command === "by" && directByUnavailable)
        return { stdout: "", stderr: "", code: 1, killed: false };
      if (command === "by") return result(JSON.stringify(currentSnapshot));
      if (command === "just" && args[0] === "by" && directByUnavailable)
        return result(JSON.stringify(currentSnapshot));
      if (command === "git" && args[0] === "rev-parse") return result("head\n");
      if (command === "git" && args[0] === "status") return result("");
      if (command === "git" && (args[0] === "diff" || args[0] === "ls-files")) return result("");
      return { stdout: "", stderr: "", code: 1, killed: false };
    },
  } as unknown as ExtensionAPI;
  continueChange(api);
  const context = {
    cwd: "/managed/change",
    sessionManager: { getBranch: () => [...entries] },
    ui: {
      notify(message: string) {
        notifications.push(message);
      },
      setWidget(name: string, value: unknown) {
        widgets.push({ name, value });
      },
    },
  } as unknown as ExtensionContext;
  return {
    handlers,
    context,
    entries,
    async runCommand(name: string) {
      const handler = commands.get(name);
      if (handler === undefined) throw new Error(`Missing ${name} command`);
      await handler("", context);
    },
    sent,
    notifications,
    widgets,
    execCalls,
    getExecCallCount() {
      return execCalls.length;
    },
    setSnapshot(next: TestSnapshot) {
      currentSnapshot = next;
    },
    setInspectionFails(value: boolean) {
      inspectionFails = value;
    },
    setDirectByUnavailable(value: boolean) {
      directByUnavailable = value;
    },
    async emit(event: string, value: unknown = {}) {
      const handler = handlers.get(event);
      if (handler === undefined) throw new Error(`Missing ${event} handler`);
      await handler(value, context);
    },
  };
};

const result = (stdout: string) => ({ stdout, stderr: "", code: 0, killed: false });

describe("packaged Change Implement continuation extension", () => {
  it("sends a state-specific turn for an unfinished Change", async () => {
    const harness = createHarness();

    await harness.emit("session_start", { type: "session_start", reason: "startup" });
    await harness.emit("agent_settled");

    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0]).toContain("take the next concrete implementation action");
  });

  it("uses the local source CLI when the installed by executable is unavailable", async () => {
    const harness = createHarness();
    harness.setDirectByUnavailable(true);

    await harness.emit("session_start", { type: "session_start", reason: "startup" });
    await harness.emit("agent_settled");

    expect(harness.sent).toHaveLength(1);
    expect(harness.execCalls).toContainEqual({
      command: "just",
      args: ["by", "change", "show", changeId, "--output", "json"],
    });
  });

  it("does not leave an inspection failure idle", async () => {
    const harness = createHarness();
    harness.setInspectionFails(true);

    await harness.emit("session_start", { type: "session_start", reason: "startup" });
    await harness.emit("agent_settled");
    await harness.emit("agent_settled");
    await harness.emit("agent_settled");

    expect(harness.sent).toHaveLength(3);
    expect(harness.sent[0]).toContain("Restore But Why CLI and Git access");
    expect(harness.notifications[0]).toContain("automatic continuation will keep trying");

    await harness.emit("agent_settled");

    expect(harness.sent).toHaveLength(3);
    expect(harness.notifications.at(-1)).toContain("stopped after three inspection failures");
  });

  it("keeps the restart limit when inspection fails after progress was observed", async () => {
    const harness = createHarness();
    await harness.emit("session_start", { type: "session_start", reason: "startup" });
    await harness.emit("agent_settled");
    harness.setInspectionFails(true);

    await harness.emit("agent_settled");
    await harness.emit("agent_settled");
    await harness.emit("agent_settled");

    expect(harness.sent).toHaveLength(3);
    expect(harness.notifications.at(-1)).toContain("stopped after three inspection failures");
  });

  it("does not wake a session for durable stopping conditions", async () => {
    const harness = createHarness();
    await harness.emit("session_start", { type: "session_start", reason: "startup" });
    harness.setSnapshot(snapshot({ change: { state: "blocked", closeReason: null } }));

    await harness.emit("agent_settled");

    expect(harness.sent).toEqual([]);
  });

  it("stops after three unchanged automatic restarts and warns the operator", async () => {
    const harness = createHarness();
    await harness.emit("session_start", { type: "session_start", reason: "startup" });

    await harness.emit("agent_settled");
    await harness.emit("agent_settled");
    await harness.emit("agent_settled");

    expect(harness.sent).toHaveLength(3);
    expect(harness.notifications).toEqual([]);

    await harness.emit("agent_settled");

    expect(harness.sent).toHaveLength(3);
    expect(harness.notifications).toContain(
      "But Why automatic continuation stopped after three restarts without Git or Change progress. Take the next action manually.",
    );
  });

  it("pauses after manual cancellation until the operator toggles continuation", async () => {
    const harness = createHarness();
    await harness.emit("session_start", { type: "session_start", reason: "startup" });
    await harness.emit("agent_end", {
      messages: [
        {
          role: "assistant",
          content: [],
          stopReason: "aborted",
        },
      ],
    });
    await harness.emit("session_compact", { reason: "threshold" });
    await harness.emit("agent_end", {
      messages: [{ role: "assistant", content: [], stopReason: "aborted" }],
    });
    await harness.emit("agent_settled");
    expect(harness.sent).toEqual([]);

    await harness.emit("input", { text: "Continue", source: "interactive" });
    await harness.emit("agent_settled");
    expect(harness.sent).toEqual([]);

    await harness.runCommand("continue-change");
    expect(harness.sent).toEqual([
      expect.stringContaining("Automatic threshold compaction completed"),
    ]);
  });

  it("does not inspect the Change before a normal prompt starts", async () => {
    const harness = createHarness();
    await harness.emit("session_start", { type: "session_start", reason: "startup" });

    const execCallCount = harness.getExecCallCount();
    await harness.emit("input", { text: "Explain the current approach.", source: "interactive" });

    expect(harness.getExecCallCount()).toBe(execCallCount);
  });

  it("keeps automatic continuation paused while the operator discusses the Change", async () => {
    const harness = createHarness();
    await harness.emit("session_start", { type: "session_start", reason: "startup" });
    expect(harness.widgets.at(-1)).toEqual({
      name: "but-why-change-watcher",
      value: [`● Watching Change ${changeId.slice(0, 8)}…`],
    });

    await harness.runCommand("continue-change");
    expect(harness.widgets.at(-1)).toEqual({
      name: "but-why-change-watcher",
      value: ["○ Paused"],
    });
    expect(harness.entries.at(-1)).toMatchObject({
      data: { changeId, unchangedRestarts: 0, paused: true },
    });

    const execCallCount = harness.getExecCallCount();
    await harness.emit("input", { text: "Why is this approach safe?", source: "interactive" });
    await harness.emit("agent_settled");
    expect(harness.sent).toEqual([]);
    expect(harness.getExecCallCount()).toBe(execCallCount);

    await harness.runCommand("continue-change");
    expect(harness.entries.at(-1)).toMatchObject({
      data: { changeId, paused: false },
    });
    expect(harness.sent).toEqual([
      expect.stringContaining(`The Change ${changeId} is still unfinished.`),
    ]);
    expect(harness.widgets.at(-1)).toEqual({
      name: "but-why-change-watcher",
      value: [`● Watching Change ${changeId.slice(0, 8)}…`],
    });
  });

  it("does not send a continuation message when resumed after the Change is closed", async () => {
    const harness = createHarness();
    await harness.emit("session_start", { type: "session_start", reason: "startup" });

    await harness.runCommand("continue-change");
    harness.setSnapshot(snapshot({ change: { state: "closed", closeReason: "completed" } }));
    await harness.runCommand("continue-change");

    expect(harness.sent).toEqual([]);
    expect(harness.widgets.at(-1)).toEqual({
      name: "but-why-change-watcher",
      value: ["✓ Change is complete"],
    });
  });

  it("uses hidden session entries for retry state", async () => {
    const harness = createHarness();
    await harness.emit("session_start", { type: "session_start", reason: "startup" });

    expect(harness.entries.at(-1)).toMatchObject({
      type: "custom",
      customType: "but-why-change-continuation",
      data: { changeId, unchangedRestarts: 0, paused: false },
    });
  });
});
