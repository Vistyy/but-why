import { fileURLToPath } from "node:url";

import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import continueChange from "../../extensions/continue-change.js";

const changeId = "BY-C1";

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  change: {
    state: "open",
    closeReason: null,
    acceptanceContext: { version: 1, title: "Accepted", description: "Accepted." },
    baseRef: "refs/remotes/origin/main",
  },
  currentCandidate: null,
  currentValidationRun: null,
  findingCount: 0,
  toolingFailureCount: 0,
  pullRequest: null,
  ...overrides,
});

type TestBlockerHistory = {
  blockers: Record<string, unknown>[];
  resolutions: Record<string, unknown>[];
  active: Record<string, unknown> | null;
};

const validTestBlockerHistory = (resolutionContent?: string): TestBlockerHistory => {
  const resolution =
    resolutionContent === undefined ? null : { blockerId: 1, content: resolutionContent };
  const blocker = {
    id: 1,
    changeId,
    content: "The Operator must approve the implementation direction.",
    resolution,
  };
  return {
    blockers: [blocker],
    resolutions: resolution === null ? [] : [resolution],
    active: resolution === null ? blocker : null,
  };
};

type EventHandler = (event: unknown, context: ExtensionContext) => unknown;
type CommandHandler = (args: string, context: ExtensionContext) => unknown;

const sourceCwd = fileURLToPath(new URL("../../", import.meta.url));

const createHarness = (cwd = sourceCwd, initialPersistedState?: unknown) => {
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
  if (initialPersistedState !== undefined) {
    entries.push({
      type: "custom",
      id: "custom-persisted",
      parentId: entries.at(-1)?.id ?? null,
      timestamp: new Date().toISOString(),
      customType: "but-why-change-continuation",
      data: initialPersistedState,
    });
  }
  const sent: string[] = [];
  const sendOptions: unknown[] = [];
  const notifications: string[] = [];
  const widgets: Array<{ readonly name: string; readonly value: unknown }> = [];
  let currentSnapshot: unknown = snapshot();
  let currentBlockerHistory: TestBlockerHistory = { blockers: [], resolutions: [], active: null };
  let blockerInspectionOutput: string | undefined;
  let inspectionFails = false;
  let inspectionGate: Promise<void> | undefined;
  let releaseInspection: (() => void) | undefined;
  let idle = true;
  let abortCount = 0;
  const execCalls: Array<{ readonly command: string; readonly args: readonly string[] }> = [];
  const execSignals: Array<AbortSignal | undefined> = [];
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
    sendUserMessage(message: string, options?: unknown) {
      sent.push(message);
      sendOptions.push(options);
    },
    async exec(command: string, args: string[], options?: { signal?: AbortSignal }) {
      execCalls.push({ command, args });
      execSignals.push(options?.signal);
      const installedCli = command === "by";
      if (installedCli && inspectionGate !== undefined) {
        await Promise.race([
          inspectionGate,
          new Promise<void>((resolve) =>
            options?.signal?.addEventListener("abort", () => resolve()),
          ),
        ]);
        if (options?.signal?.aborted) {
          return { stdout: "", stderr: "", code: 1, killed: true };
        }
      }
      if (installedCli && inspectionFails) return { stdout: "", stderr: "", code: 1, killed: true };
      if (installedCli && args.includes("blocker"))
        return result(blockerInspectionOutput ?? JSON.stringify(currentBlockerHistory));
      if (installedCli) return result(JSON.stringify(currentSnapshot));
      if (command === "git" && args[0] === "rev-parse") return result("head\n");
      if (command === "git" && args[0] === "status") return result("");
      if (command === "git" && (args[0] === "diff" || args[0] === "ls-files")) return result("");
      return { stdout: "", stderr: "", code: 1, killed: false };
    },
  } as unknown as ExtensionAPI;
  continueChange(api);
  const context = {
    cwd,
    sessionManager: { getBranch: () => [...entries] },
    isIdle: () => idle,
    abort: () => {
      abortCount += 1;
    },
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
    sendOptions,
    notifications,
    widgets,
    execCalls,
    getExecCallCount() {
      return execCalls.length;
    },
    getAbortedExecCount() {
      return execSignals.filter((signal) => signal?.aborted).length;
    },
    getAbortCount() {
      return abortCount;
    },
    setSnapshot(next: unknown) {
      currentSnapshot = next;
    },
    setInspectionFails(value: boolean) {
      inspectionFails = value;
    },
    blockInspection() {
      inspectionGate = new Promise<void>((resolve) => {
        releaseInspection = resolve;
      });
    },
    releaseInspection() {
      releaseInspection?.();
      inspectionGate = undefined;
    },
    setBlockerHistory(next: TestBlockerHistory) {
      currentBlockerHistory = next;
    },
    setBlockerInspectionOutput(next: string | undefined) {
      blockerInspectionOutput = next;
    },
    setIdle(value: boolean) {
      idle = value;
    },
    latestWidgetText() {
      const value = widgets.at(-1)?.value;
      if (typeof value !== "function") return value;
      return value(undefined, { fg: (_color: string, text: string) => text }).render(80);
    },
    latestWidgetColor() {
      const value = widgets.at(-1)?.value;
      if (typeof value !== "function") return undefined;
      return value(undefined, { fg: (color: string) => color }).render(80);
    },
    async emit(event: string, value: unknown = {}) {
      const handler = handlers.get(event);
      if (handler === undefined) throw new Error(`Missing ${event} handler`);
      return await handler(value, context);
    },
  };
};

const result = (stdout: string) => ({ stdout, stderr: "", code: 0, killed: false });

describe("packaged Change Implement continuation extension", () => {
  it("interrupts the first Submission with Acceptance Context and permits an immediate retry", async () => {
    const harness = createHarness();
    await harness.emit("session_start", { type: "session_start", reason: "startup" });
    const submit = {
      type: "tool_call",
      toolCallId: "submit-1",
      toolName: "bash",
      input: { command: `git status && by change submit ${changeId}` },
    };

    const first = await harness.emit("tool_call", submit);
    expect(first).toMatchObject({
      block: true,
      reason: expect.stringContaining("before any part of it executed"),
    });
    expect(first).toMatchObject({
      reason: expect.stringContaining("reassess the complete committed implementation"),
    });
    expect(harness.sent).toEqual([
      expect.stringContaining("re-read the complete current Acceptance Context"),
    ]);
    expect(harness.sendOptions).toEqual([{ deliverAs: "steer" }]);

    expect(await harness.emit("tool_call", { ...submit, toolCallId: "submit-2" })).toBeUndefined();
    expect(harness.latestWidgetText()).toEqual(["◐ Validating revision"]);
  });

  it("does not repeat the interruption after restoring handled session state", async () => {
    const harness = createHarness(sourceCwd, {
      changeId,
      fingerprint: "saved",
      unchangedRestarts: 0,
      paused: false,
      initialSubmissionHandled: true,
    });
    await harness.emit("session_start", { type: "session_start", reason: "resume" });
    const inspectionCallCount = harness.getExecCallCount();

    expect(
      await harness.emit("tool_call", {
        type: "tool_call",
        toolCallId: "submit-1",
        toolName: "bash",
        input: { command: `by change submit ${changeId}` },
      }),
    ).toBeUndefined();
    expect(harness.getExecCallCount()).toBe(inspectionCallCount);
    expect(harness.sent).toEqual([]);
  });

  it("shows validation during an allowed Change Submit and retains the publication URL", async () => {
    const harness = createHarness(sourceCwd, {
      changeId,
      fingerprint: "saved",
      unchangedRestarts: 0,
      paused: false,
      initialSubmissionHandled: true,
    });
    harness.setSnapshot(
      snapshot({
        currentCandidate: { id: 2, headSha: "head" },
        publication: {
          candidateId: 1,
          expectedHeadSha: "old-head",
          pullRequest: { number: 12, url: "https://github.test/pull/12" },
        },
        pullRequest: { number: 12, url: "https://github.test/pull/12" },
      }),
    );
    await harness.emit("session_start", { type: "session_start", reason: "resume" });

    expect(
      await harness.emit("tool_call", {
        type: "tool_call",
        toolCallId: "submit-1",
        toolName: "bash",
        input: { command: `by change submit ${changeId}` },
      }),
    ).toBeUndefined();
    expect(harness.latestWidgetText()).toEqual([
      "◐ Validating revision - https://github.test/pull/12",
    ]);
  });

  it("does not interrupt Changes without a Task or Change Submit help", async () => {
    const harness = createHarness();
    harness.setSnapshot(
      snapshot({ change: { state: "open", closeReason: null, acceptanceContext: null } }),
    );
    await harness.emit("session_start", { type: "session_start", reason: "startup" });
    const inspectionCallCount = harness.getExecCallCount();
    const blockerInspectionCallCount = harness.execCalls.filter(({ args }) =>
      args.includes("blocker"),
    ).length;

    expect(
      await harness.emit("tool_call", {
        type: "tool_call",
        toolCallId: "help-1",
        toolName: "bash",
        input: { command: "by change submit --help" },
      }),
    ).toBeUndefined();
    expect(harness.getExecCallCount()).toBe(inspectionCallCount);
    expect(
      await harness.emit("tool_call", {
        type: "tool_call",
        toolCallId: "submit-1",
        toolName: "bash",
        input: { command: `by change submit ${changeId}` },
      }),
    ).toBeUndefined();
    expect(harness.execCalls.filter(({ args }) => args.includes("blocker"))).toHaveLength(
      blockerInspectionCallCount,
    );
    expect(harness.sent).toEqual([]);
  });

  it("fails closed when eligibility inspection is unavailable", async () => {
    const harness = createHarness();
    await harness.emit("session_start", { type: "session_start", reason: "startup" });
    harness.setInspectionFails(true);

    const result = await harness.emit("tool_call", {
      type: "tool_call",
      toolCallId: "submit-1",
      toolName: "bash",
      input: { command: `by change submit ${changeId}` },
    });

    expect(result).toMatchObject({
      block: true,
      reason: expect.stringContaining("trusted Change inspection could not determine"),
    });
    expect(harness.sent).toEqual([]);
  });

  it("does not queue a continuation while another agent run is active", async () => {
    const harness = createHarness();
    await harness.emit("session_start", { type: "session_start", reason: "startup" });
    const execCallCount = harness.getExecCallCount();
    harness.setIdle(false);

    await harness.emit("agent_settled");

    expect(harness.sent).toEqual([]);
    expect(harness.getExecCallCount()).toBe(execCallCount);
  });

  it("uses the globally installed executable from every worktree", async () => {
    const harness = createHarness();

    await harness.emit("session_start", { type: "session_start", reason: "startup" });
    await harness.emit("agent_settled");

    expect(harness.sent).toHaveLength(1);
    expect(harness.execCalls).toContainEqual({
      command: "by",
      args: ["change", "show", changeId],
    });
    expect(harness.execCalls).toContainEqual({
      command: "by",
      args: ["change", "blocker", "list", changeId],
    });
    expect(harness.sent[0]).toContain(`by change show ${changeId}`);
  });

  it("does not leave an inspection failure idle", async () => {
    const harness = createHarness();
    harness.setInspectionFails(true);

    await harness.emit("session_start", { type: "session_start", reason: "startup" });
    await harness.emit("agent_settled");
    await harness.emit("agent_settled");
    await harness.emit("agent_settled");

    expect(harness.sent).toHaveLength(3);
    expect(harness.notifications.length).toBeGreaterThan(0);

    await harness.emit("agent_settled");

    expect(harness.sent).toHaveLength(3);
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
    expect(harness.notifications.length).toBeGreaterThan(0);
  });

  it("does not wake a session for durable stopping conditions", async () => {
    const harness = createHarness();
    await harness.emit("session_start", { type: "session_start", reason: "startup" });
    harness.setSnapshot(snapshot({ toolingFailureCount: 1 }));

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
    expect(harness.notifications).toHaveLength(1);
  });

  it("pauses after manual cancellation until the operator explicitly continues", async () => {
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
    await harness.emit("agent_end", {
      messages: [{ role: "assistant", content: [], stopReason: "aborted" }],
    });
    await harness.emit("agent_settled");
    expect(harness.sent).toEqual([]);

    await harness.emit("input", { text: "Continue", source: "interactive" });
    await harness.emit("agent_settled");
    expect(harness.sent).toEqual([]);

    await harness.runCommand("continue-change");
    expect(harness.sent).toHaveLength(1);
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
    expect(harness.widgets.at(-1)?.name).toBe("but-why-change-watcher");
    expect(harness.latestWidgetText()).toEqual(["● Implementing revision"]);

    await harness.runCommand("pause-change");
    expect(harness.latestWidgetText()).toEqual(["○ Paused"]);
    expect(harness.latestWidgetColor()).toEqual(["warning"]);
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
      expect.stringContaining(`Resume implementation of Change ${changeId}.`),
    ]);
    expect(harness.latestWidgetText()).toEqual(["● Implementing revision"]);
  });

  it("refreshes and continues without toggling when the operator runs continue twice", async () => {
    const harness = createHarness();
    await harness.emit("session_start", { type: "session_start", reason: "startup" });

    await harness.runCommand("continue-change");
    await harness.runCommand("continue-change");

    expect(harness.sent).toHaveLength(2);
    expect(harness.entries.at(-1)).toMatchObject({ data: { paused: false } });
  });

  it("stops when blocker history is active even if the Change snapshot is open", async () => {
    const harness = createHarness();
    harness.setBlockerHistory(validTestBlockerHistory());

    await harness.emit("session_start", { type: "session_start", reason: "startup" });
    await harness.emit("agent_settled");

    expect(harness.sent).toEqual([]);
    expect(harness.latestWidgetText()).toEqual(["! Change is blocked"]);
  });

  it("aborts after a turn when trusted blocker state is active without pausing the session", async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      harness.setBlockerHistory(validTestBlockerHistory());
      await harness.emit("session_start", { type: "session_start", reason: "startup" });

      await harness.emit("turn_end", { toolResults: [{}] });
      await harness.emit("agent_end", {
        messages: [{ role: "assistant", content: [], stopReason: "aborted" }],
      });
      await harness.emit("agent_settled");

      expect(harness.getAbortCount()).toBe(1);
      expect(harness.sent).toEqual([]);
      expect(harness.entries.at(-1)).toMatchObject({ data: { paused: false } });
      expect(harness.latestWidgetText()).toEqual(["! Change is blocked"]);

      harness.setBlockerHistory(validTestBlockerHistory("Continue safely."));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(harness.sent).toEqual([expect.stringContaining("Continue safely.")]);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(harness.sent).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts and pauses for explicit recovery when trusted blocker inspection fails", async () => {
    const harness = createHarness();
    await harness.emit("session_start", { type: "session_start", reason: "startup" });
    harness.setInspectionFails(true);

    await harness.emit("turn_end", { toolResults: [{}] });
    await harness.emit("agent_end", {
      messages: [{ role: "assistant", content: [], stopReason: "aborted" }],
    });

    expect(harness.getAbortCount()).toBe(1);
    expect(harness.sent).toEqual([]);
    expect(harness.entries.at(-1)).toMatchObject({ data: { paused: true } });
    expect(harness.latestWidgetText()).toEqual(["! Change inspection failed"]);
  });

  it("aborts and pauses when trusted blocker JSON cannot be decoded", async () => {
    const harness = createHarness();
    await harness.emit("session_start", { type: "session_start", reason: "startup" });
    harness.setBlockerInspectionOutput("not-json");

    await harness.emit("turn_end", { toolResults: [{}] });
    await harness.emit("agent_end", {
      messages: [{ role: "assistant", content: [], stopReason: "aborted" }],
    });

    expect(harness.getAbortCount()).toBe(1);
    expect(harness.entries.at(-1)).toMatchObject({ data: { paused: true } });
    expect(harness.latestWidgetText()).toEqual(["! Change inspection failed"]);
  });

  it("handles an existing Resolution when a new bound session starts unpaused", async () => {
    const harness = createHarness();
    harness.setBlockerHistory(validTestBlockerHistory("Use the approved design."));

    await harness.emit("session_start", { type: "session_start", reason: "startup" });

    expect(harness.sent).toEqual([expect.stringContaining("Use the approved design.")]);
    expect(harness.entries.at(-1)).toMatchObject({
      data: { resolutionBlockerId: 1, pendingResolutionBlockerId: null },
    });
  });

  it("polls a blocked Change every 30 seconds and resumes once for a new Resolution", async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      harness.setBlockerHistory(validTestBlockerHistory());
      await harness.emit("session_start", { type: "session_start", reason: "startup" });
      const initialInspectionCalls = harness.getExecCallCount();

      await vi.advanceTimersByTimeAsync(29_999);
      expect(harness.getExecCallCount()).toBe(initialInspectionCalls);

      harness.setBlockerHistory(validTestBlockerHistory("Use the approved design."));
      await vi.advanceTimersByTimeAsync(1);

      expect(harness.sent).toEqual([expect.stringContaining("Use the approved design.")]);
      const resolvedInspectionCalls = harness.getExecCallCount();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(harness.getExecCallCount()).toBe(resolvedInspectionCalls);
      expect(harness.sent).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps polling a blocked Change after a transient inspection failure", async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      harness.setBlockerHistory(validTestBlockerHistory());
      await harness.emit("session_start", { type: "session_start", reason: "startup" });

      harness.setInspectionFails(true);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(harness.sent).toEqual([]);
      expect(harness.latestWidgetText()).toEqual(["! Change is blocked"]);

      harness.setInspectionFails(false);
      harness.setBlockerHistory(validTestBlockerHistory("Continue safely."));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(harness.sent).toEqual([expect.stringContaining("Continue safely.")]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds a Resolution while paused and handles it on explicit continuation", async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      harness.setBlockerHistory(validTestBlockerHistory());
      await harness.emit("session_start", { type: "session_start", reason: "startup" });
      await harness.runCommand("pause-change");
      const pausedInspectionCalls = harness.getExecCallCount();

      harness.setBlockerHistory(validTestBlockerHistory("Continue safely."));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(harness.getExecCallCount()).toBe(pausedInspectionCalls);
      expect(harness.sent).toEqual([]);

      await harness.runCommand("continue-change");
      expect(harness.sent).toEqual([expect.stringContaining("Continue safely.")]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not overlap blocked inspections and pause overrides the inspection in progress", async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      harness.setBlockerHistory(validTestBlockerHistory());
      await harness.emit("session_start", { type: "session_start", reason: "startup" });
      harness.blockInspection();

      await vi.advanceTimersByTimeAsync(30_000);
      const inProgressCallCount = harness.getExecCallCount();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(harness.getExecCallCount()).toBe(inProgressCallCount);

      await harness.runCommand("pause-change");
      harness.releaseInspection();
      await Promise.resolve();
      expect(harness.sent).toEqual([]);
      expect(harness.latestWidgetText()).toEqual(["○ Paused"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cleans up blocked polling when the session shuts down", async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      harness.setBlockerHistory(validTestBlockerHistory());
      await harness.emit("session_start", { type: "session_start", reason: "startup" });
      const initialInspectionCalls = harness.getExecCallCount();

      await harness.emit("session_shutdown");
      await vi.advanceTimersByTimeAsync(60_000);

      expect(harness.getExecCallCount()).toBe(initialInspectionCalls);

      const inFlight = createHarness();
      inFlight.setBlockerHistory(validTestBlockerHistory());
      await inFlight.emit("session_start", { type: "session_start", reason: "startup" });
      inFlight.blockInspection();
      await vi.advanceTimersByTimeAsync(30_000);
      inFlight.setBlockerHistory(validTestBlockerHistory("Do not deliver after shutdown."));
      await inFlight.emit("session_shutdown");
      await Promise.resolve();
      expect(inFlight.getAbortedExecCount()).toBeGreaterThan(0);
      expect(inFlight.sent).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("delivers an existing Resolution after startup inspection recovers", async () => {
    const harness = createHarness();
    harness.setInspectionFails(true);

    await harness.emit("session_start", { type: "session_start", reason: "startup" });

    harness.setInspectionFails(false);
    harness.setBlockerHistory(validTestBlockerHistory("Continue safely."));
    await harness.emit("agent_settled");

    expect(harness.sent).toEqual([expect.stringContaining("Continue safely.")]);
  });

  it("automatically resumes after an external blocker Resolution and explains it before old Findings", async () => {
    const harness = createHarness();
    harness.setSnapshot(
      snapshot({
        change: {
          state: "open",
          closeReason: null,
          acceptanceContext: { version: 1, title: "Accepted", description: "Accepted." },
        },
      }),
    );
    await harness.emit("session_start", { type: "session_start", reason: "startup" });

    harness.setSnapshot(snapshot({ findingCount: 1 }));
    harness.setBlockerHistory(validTestBlockerHistory("Use the approved design."));
    await harness.emit("agent_settled");

    expect(harness.sent).toHaveLength(1);
    expect(harness.latestWidgetText()).toEqual(["● Implementing revision"]);
    const message = harness.sent[0];
    expect(message).toBeDefined();
    expect(message).toContain("Use the approved design.");
    expect(message?.indexOf("Use the approved design.")).toBeLessThan(
      message?.indexOf("earlier Findings") ?? -1,
    );
  });

  it("gives Validation Tooling Failure recovery guidance only on explicit continuation", async () => {
    const harness = createHarness();
    await harness.emit("session_start", { type: "session_start", reason: "startup" });
    harness.setSnapshot(
      snapshot({
        toolingFailureCount: 1,
        currentValidationRun: { id: 1, state: "complete" },
      }),
    );

    await harness.emit("agent_settled");
    expect(harness.sent).toEqual([]);
    expect(harness.latestWidgetText()).toEqual(["! Watching stopped - no progress"]);

    await harness.runCommand("continue-change");
    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0]).toContain("by validation-run show 1");
  });

  it("keeps the first Change identity bound to the Pi session", async () => {
    const harness = createHarness();
    await harness.emit("session_start", { type: "session_start", reason: "startup" });
    await harness.emit("input", {
      text: "Change identity: BY-C2.",
      source: "interactive",
    });
    await harness.runCommand("continue-change");

    expect(harness.execCalls.filter(({ command }) => command === "by").at(-1)).toMatchObject({
      args: expect.arrayContaining([changeId]),
    });
    expect(harness.latestWidgetText()).toEqual(["● Implementing revision"]);
  });

  it("reports waiting for human review with the published Candidate URL", async () => {
    const harness = createHarness();
    await harness.emit("session_start", { type: "session_start", reason: "startup" });
    harness.setSnapshot(
      snapshot({
        currentCandidate: { id: 1, headSha: "head" },
        currentValidationRun: { id: 1, state: "complete" },
        publication: {
          candidateId: 1,
          expectedHeadSha: "head",
          pullRequest: { number: 12, url: "https://github.test/pull/12" },
        },
        pullRequest: { number: 12, url: "https://github.test/pull/12" },
      }),
    );

    await harness.emit("agent_settled");
    expect(harness.sent).toEqual([]);
    expect(harness.latestWidgetText()).toEqual([
      "◌ Waiting for human review - https://github.test/pull/12",
    ]);

    await harness.runCommand("continue-change");

    expect(harness.sent).toHaveLength(1);
    expect(harness.latestWidgetText()).toEqual([
      "● Implementing revision - https://github.test/pull/12",
    ]);
  });

  it("shows the pull request URL during revision implementation and validation", async () => {
    const harness = createHarness();
    harness.setSnapshot(
      snapshot({
        currentCandidate: { id: 2, headSha: "head" },
        publication: {
          candidateId: 1,
          expectedHeadSha: "old-head",
          pullRequest: { number: 12, url: "https://github.test/pull/12" },
        },
        pullRequest: { number: 12, url: "https://github.test/pull/12" },
      }),
    );
    await harness.emit("session_start", { type: "session_start", reason: "startup" });
    expect(harness.latestWidgetText()).toEqual([
      "● Implementing revision - https://github.test/pull/12",
    ]);

    harness.setSnapshot(
      snapshot({
        currentCandidate: { id: 2, headSha: "head" },
        currentValidationRun: { id: 2, state: "running" },
        publication: {
          candidateId: 1,
          expectedHeadSha: "old-head",
          pullRequest: { number: 12, url: "https://github.test/pull/12" },
        },
        pullRequest: { number: 12, url: "https://github.test/pull/12" },
      }),
    );
    await harness.runCommand("continue-change");
    expect(harness.latestWidgetText()).toEqual([
      "◐ Validating revision - https://github.test/pull/12",
    ]);
  });

  it("reports cancelled and cleanup-needed terminal states", async () => {
    const cancelled = createHarness();
    await cancelled.emit("session_start", { type: "session_start", reason: "startup" });
    cancelled.setSnapshot(
      snapshot({
        change: {
          state: "closed",
          closeReason: "cancelled",
          acceptanceContext: { version: 1, title: "Accepted", description: "Accepted." },
        },
      }),
    );
    await cancelled.runCommand("continue-change");
    expect(cancelled.latestWidgetText()).toEqual(["✕ Change was cancelled"]);

    const cleanup = createHarness();
    await cleanup.emit("session_start", { type: "session_start", reason: "startup" });
    cleanup.setSnapshot(
      snapshot({
        change: {
          state: "closed",
          closeReason: "completed",
          acceptanceContext: { version: 1, title: "Accepted", description: "Accepted." },
        },
        cleanup: { state: "pending", blockingReason: "worktree" },
      }),
    );
    await cleanup.runCommand("continue-change");
    expect(cleanup.latestWidgetText()).toEqual(["! Change cleanup is needed"]);
  });

  it("does not send after pause cancels an in-flight inspection", async () => {
    const harness = createHarness();
    await harness.emit("session_start", { type: "session_start", reason: "startup" });
    harness.blockInspection();

    const settled = harness.emit("agent_settled");
    await Promise.resolve();
    await harness.runCommand("pause-change");
    harness.releaseInspection();
    await settled;

    expect(harness.sent).toEqual([]);
    expect(harness.latestWidgetText()).toEqual(["○ Paused"]);
  });

  it("shows terminal state and stops polling when a closed Change retains an active blocker", async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      harness.setBlockerHistory(validTestBlockerHistory());
      await harness.emit("session_start", { type: "session_start", reason: "startup" });

      harness.setSnapshot(
        snapshot({
          change: {
            state: "closed",
            closeReason: "cancelled",
            acceptanceContext: { version: 1, title: "Accepted", description: "Accepted." },
          },
        }),
      );
      await vi.advanceTimersByTimeAsync(30_000);
      const terminalInspectionCalls = harness.getExecCallCount();

      expect(harness.sent).toEqual([]);
      expect(harness.latestWidgetText()).toEqual(["✕ Change was cancelled"]);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(harness.getExecCallCount()).toBe(terminalInspectionCalls);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not send a continuation message when resumed after the Change is closed", async () => {
    const harness = createHarness();
    await harness.emit("session_start", { type: "session_start", reason: "startup" });

    await harness.runCommand("pause-change");
    harness.setSnapshot(
      snapshot({
        change: {
          state: "closed",
          closeReason: "completed",
          acceptanceContext: { version: 1, title: "Accepted", description: "Accepted." },
        },
      }),
    );
    await harness.runCommand("continue-change");

    expect(harness.sent).toEqual([]);
    expect(harness.latestWidgetText()).toEqual(["✓ Change is complete"]);
    expect(harness.latestWidgetColor()).toEqual(["success"]);
  });

  it.each([
    [
      "Change close reason",
      snapshot({
        change: {
          state: "closed",
          closeReason: "not-a-close-reason",
          acceptanceContext: { version: 1, title: "Accepted", description: "Accepted." },
        },
      }),
      undefined,
    ],
    ["Candidate identity", snapshot({ currentCandidate: { id: "candidate-1" } }), undefined],
    [
      "Validation Run identity and state",
      snapshot({ currentValidationRun: { id: "validation-run-1", state: "not-a-state" } }),
      undefined,
    ],
    ["non-negative Finding count", snapshot({ findingCount: -1 }), undefined],
    ["integer Tooling Failure count", snapshot({ toolingFailureCount: 0.5 }), undefined],
    [
      "publication identity",
      snapshot({ publication: { candidateId: 1, pullRequest: null } }),
      undefined,
    ],
    ["JSON object", undefined, { blockers: [], resolutions: [], active: [] }],
    [
      "Resolution identity and text",
      undefined,
      {
        blockers: [{ body: { opaque: true } }],
        resolutions: [{ blockerId: 1 }],
        active: null,
      },
    ],
    [
      "active blocker relationship",
      undefined,
      {
        blockers: [
          {
            id: 1,
            changeId,
            content: "The Operator must approve the implementation direction.",
            resolution: null,
          },
        ],
        resolutions: [],
        active: {
          id: 2,
          changeId,
          content: "The Operator must approve the implementation direction.",
          resolution: null,
        },
      },
    ],
    [
      "Resolution order",
      undefined,
      {
        blockers: [
          {
            id: 1,
            changeId,
            content: "First blocker.",
            resolution: { blockerId: 1, content: "First resolution." },
          },
          {
            id: 2,
            changeId,
            content: "Second blocker.",
            resolution: { blockerId: 2, content: "Second resolution." },
          },
        ],
        resolutions: [
          { blockerId: 2, content: "Second resolution." },
          { blockerId: 1, content: "First resolution." },
        ],
        active: null,
      },
    ],
  ])("rejects malformed %s control data without continuing", async (_name, malformedSnapshot, malformedHistory) => {
    const harness = createHarness();
    if (malformedSnapshot !== undefined) harness.setSnapshot(malformedSnapshot);
    if (malformedHistory !== undefined)
      harness.setBlockerHistory(malformedHistory as TestBlockerHistory);

    await harness.emit("session_start", { type: "session_start", reason: "startup" });
    await harness.emit("agent_settled");

    expect(harness.sent).toEqual([]);
    expect(harness.latestWidgetText()).toEqual(["! Change inspection failed"]);
  });

  it.each([-1, 0.5])("ignores invalid persisted retry count %s", async (unchangedRestarts) => {
    const harness = createHarness(sourceCwd, {
      changeId,
      fingerprint: "untrusted",
      unchangedRestarts,
      paused: true,
    });

    await harness.emit("session_start", { type: "session_start", reason: "startup" });
    await harness.emit("agent_settled");

    expect(harness.sent).toHaveLength(1);
    expect(harness.entries.at(-1)).toMatchObject({ data: { paused: false, unchangedRestarts: 1 } });
  });

  it("ignores persisted state for a different Change", async () => {
    const harness = createHarness(sourceCwd, {
      changeId: "BY-C2",
      fingerprint: "other-change",
      unchangedRestarts: 2,
      paused: true,
    });

    await harness.emit("session_start", { type: "session_start", reason: "startup" });
    await harness.emit("agent_settled");

    expect(harness.sent).toHaveLength(1);
    expect(harness.entries.at(-1)).toMatchObject({ data: { changeId, paused: false } });
  });

  it("keeps opaque cleanup details out of continuation decisions", async () => {
    const harness = createHarness();
    await harness.emit("session_start", { type: "session_start", reason: "startup" });
    harness.setSnapshot(
      snapshot({
        change: {
          state: "closed",
          closeReason: "completed",
          acceptanceContext: { version: 1, title: "Accepted", description: "Accepted." },
        },
        cleanup: { state: "pending", blockingReason: { opaque: true } },
      }),
    );

    await harness.runCommand("continue-change");

    expect(harness.sent).toEqual([]);
    expect(harness.latestWidgetText()).toEqual(["! Change cleanup is needed"]);
  });

  it("keeps unknown nested CLI data in the durable retry fingerprint", async () => {
    const harness = createHarness();
    harness.setSnapshot(snapshot({ pullRequest: { number: 12, opaque: { revision: 1 } } }));
    await harness.emit("session_start", { type: "session_start", reason: "startup" });
    await harness.emit("agent_settled");
    expect(harness.entries.at(-1)).toMatchObject({ data: { unchangedRestarts: 1 } });

    harness.setSnapshot(snapshot({ pullRequest: { number: 12, opaque: { revision: 2 } } }));
    await harness.emit("agent_settled");

    expect(harness.sent).toHaveLength(2);
    expect(harness.entries.at(-1)).toMatchObject({ data: { unchangedRestarts: 0 } });
  });

  it("uses hidden session entries for retry state", async () => {
    const harness = createHarness();
    await harness.emit("session_start", { type: "session_start", reason: "startup" });

    expect(harness.entries.at(-1)).toMatchObject({
      type: "custom",
      customType: "but-why-change-continuation",
      data: { changeId, unchangedRestarts: 0, paused: false, resolutionBlockerId: null },
    });
  });
});
