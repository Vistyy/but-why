import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../support/by-cli.js";
import { runTestProcess } from "../support/testProcess.js";
import {
  changeId,
  maxRuntimeCaseBytes,
  runtimeCaseModes,
  type RuntimeCase,
} from "./continue-change-sdk-protocol.js";

const helperPath = join(repoRoot, "test/agent/continue-change-sdk-helper.ts");
const tsxLoader = join(repoRoot, "node_modules/tsx/dist/loader.mjs");
const helperProcessTimeoutMs = 10_000;
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const textMessages = (messages: readonly unknown[]): readonly string[] =>
  messages.flatMap((message) => {
    if (!isRecord(message)) return [];
    const content = message["content"];
    if (!Array.isArray(content)) return [];
    return content.flatMap((part) => {
      if (!isRecord(part) || part["type"] !== "text") return [];
      const text = part["text"];
      return typeof text === "string" ? [text] : [];
    });
  });

const runRuntimeCase = (blocked: boolean): RuntimeCase => {
  const directory = mkdtempSync(join(tmpdir(), "but-why-pi-sdk-"));
  const byDirectory = join(directory, "bin");
  mkdirSync(byDirectory);
  createFakeBy(byDirectory, blocked);
  try {
    const result = runTestProcess(
      process.execPath,
      [
        "--import",
        tsxLoader,
        helperPath,
        repoRoot,
        blocked ? runtimeCaseModes.blocked : runtimeCaseModes.normal,
      ],
      {
        cwd: directory,
        env: { PATH: `${byDirectory}:${process.env["PATH"] ?? ""}` },
        timeout: helperProcessTimeoutMs,
      },
    );
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0) {
      throw new Error(result.stderr || `Pi SDK fixture exited with ${result.status}.`);
    }
    if (result.stdout.length > maxRuntimeCaseBytes) {
      throw new Error("Pi SDK fixture result exceeded the output bound.");
    }
    return JSON.parse(result.stdout) as RuntimeCase;
  } finally {
    rmSync(directory, { recursive: true, force: true });
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
