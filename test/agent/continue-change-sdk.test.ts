import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../support/by-cli.js";

type SessionEvent = {
  readonly type: string;
  readonly isError?: boolean;
  readonly [key: string]: unknown;
};

type RuntimeCase = {
  readonly blocked: boolean;
  readonly providerCalls: number;
  readonly events: readonly SessionEvent[];
  readonly messages: readonly unknown[];
  readonly idle: boolean;
  readonly continuationState: (Record<string, unknown> & { readonly paused?: boolean }) | undefined;
  readonly extensionErrors: readonly unknown[];
};

const changeId = "BY-C1";
const extensionPath = join(repoRoot, "extensions/continue-change.ts");
const environment = process.env as { PATH?: string };
const originalPath = environment.PATH ?? "";

const snapshot = {
  change: {
    state: "closed",
    closeReason: "completed",
    acceptanceContext: { version: 1, title: "Accepted", description: "Accepted." },
  },
  currentCandidate: null,
  currentValidationRun: null,
  findingCount: 0,
  toolingFailureCount: 0,
  pullRequest: null,
};

const createFakeBy = (directory: string, blocked: boolean): string => {
  const path = join(directory, "by");
  const blocker = {
    id: 1,
    changeId,
    content: "The Operator must approve the implementation direction.",
    resolution: null,
  };
  const blockerHistory = blocked
    ? { blockers: [blocker], resolutions: [], active: blocker }
    : { blockers: [], resolutions: [], active: null };
  writeFileSync(
    path,
    `#!/usr/bin/env node
const snapshot = ${JSON.stringify(snapshot)};
const blockerHistory = ${JSON.stringify(blockerHistory)};
const args = process.argv.slice(2);
if (args[0] === "change" && args[1] === "show" && args[2] === "${changeId}") {
  process.stdout.write(JSON.stringify(snapshot) + "\\n");
  process.exit(0);
}
if (args[0] === "change" && args[1] === "blocker" && args[2] === "list" && args[3] === "${changeId}") {
  process.stdout.write(JSON.stringify(blockerHistory) + "\\n");
  process.exit(0);
}
process.exit(2);
`,
    { mode: 0o755 },
  );
  return path;
};

const textMessages = (messages: readonly unknown[]): readonly string[] =>
  messages.flatMap((message) => {
    if (typeof message !== "object" || message === null) return [];
    const content = Reflect.get(message, "content");
    if (!Array.isArray(content)) return [];
    return content.flatMap((part) => {
      if (typeof part !== "object" || part === null || Reflect.get(part, "type") !== "text") {
        return [];
      }
      const text = Reflect.get(part, "text");
      return typeof text === "string" ? [text] : [];
    });
  });

const continuationState = (session: { readonly sessionManager: SessionManager }) => {
  const entries = session.sessionManager
    .getBranch()
    .filter(
      (entry) => entry.type === "custom" && entry.customType === "but-why-change-continuation",
    );
  const latest = entries.at(-1);
  const data = latest?.type === "custom" ? latest.data : undefined;
  return typeof data === "object" && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown> & { readonly paused?: boolean })
    : undefined;
};

const runRuntimeCase = async (blocked: boolean): Promise<RuntimeCase> => {
  const directory = mkdtempSync(join(tmpdir(), "but-why-pi-sdk-"));
  const agentDirectory = join(directory, "agent");
  const byDirectory = join(directory, "bin");
  mkdirSync(agentDirectory);
  mkdirSync(byDirectory);
  createFakeBy(byDirectory, blocked);
  const faux = fauxProvider({ provider: "but-why-test" });
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("bash", { command: "printf 'tool completed'" }, { id: "tool-call-1" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxText("second scripted response")),
  ]);
  const modelRuntime = await ModelRuntime.create({
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const resourceLoader = new DefaultResourceLoader({
    cwd: repoRoot,
    agentDir: agentDirectory,
    additionalExtensionPaths: [extensionPath],
  });
  await resourceLoader.reload();
  const { session, extensionsResult } = await createAgentSession({
    cwd: repoRoot,
    agentDir: agentDirectory,
    model: faux.getModel(),
    modelRuntime,
    resourceLoader,
    sessionManager: SessionManager.inMemory(repoRoot),
    thinkingLevel: "off",
    tools: ["bash"],
  });
  const extensionErrors: unknown[] = [];
  const events: SessionEvent[] = [];
  const unsubscribe = session.subscribe((event) => {
    events.push(event as SessionEvent);
  });
  environment.PATH = `${byDirectory}:${originalPath}`;
  try {
    expect(extensionsResult.errors).toEqual([]);
    await session.bindExtensions({
      onError: (error) => extensionErrors.push(error),
    });
    await session.prompt(`Change identity: ${changeId}.`);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(extensionErrors).toEqual([]);
    return {
      blocked,
      providerCalls: faux.state.callCount,
      events,
      messages: session.messages,
      idle: !session.isStreaming,
      continuationState: continuationState(session),
      extensionErrors,
    };
  } finally {
    unsubscribe();
    session.dispose();
    faux.setResponses([]);
    rmSync(directory, { recursive: true, force: true });
    environment.PATH = originalPath;
  }
};

describe("packaged Change Implement continuation extension Pi SDK boundary", () => {
  it("uses identical real Pi SDK setup for normal and blocked tool turns", async () => {
    const normal = await runRuntimeCase(false);
    const blocked = await runRuntimeCase(true);

    expect(normal.blocked).toBe(false);
    expect(blocked.blocked).toBe(true);
    expect(normal.providerCalls).toBe(2);
    expect(blocked.providerCalls).toBe(1);
    const normalToolEvents = normal.events.filter((event) => event.type === "tool_execution_end");
    const blockedToolEvents = blocked.events.filter((event) => event.type === "tool_execution_end");
    expect(normalToolEvents).toHaveLength(1);
    expect(blockedToolEvents).toHaveLength(1);
    expect(normalToolEvents[0]?.isError).toBe(false);
    expect(blockedToolEvents[0]?.isError).toBe(false);
    expect(blocked.events.some((event) => event.type === "agent_end")).toBe(true);
    expect(blocked.events.some((event) => event.type === "agent_settled")).toBe(true);
    const blockedToolEnd = blocked.events.findIndex((event) => event.type === "tool_execution_end");
    const blockedAgentEnd = blocked.events.findIndex((event) => event.type === "agent_end");
    const blockedAgentSettled = blocked.events.findIndex((event) => event.type === "agent_settled");
    expect(blockedToolEnd).toBeLessThan(blockedAgentEnd);
    expect(blockedAgentEnd).toBeLessThan(blockedAgentSettled);
    expect(blocked.idle).toBe(true);
    expect(textMessages(normal.messages)).toContain("second scripted response");
    expect(textMessages(blocked.messages)).not.toContain("second scripted response");
    expect(normal.continuationState?.paused).toBe(false);
    expect(blocked.continuationState?.paused).toBe(false);
    expect(normal.extensionErrors).toEqual([]);
    expect(blocked.extensionErrors).toEqual([]);
  }, 30_000);
});
