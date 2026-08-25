import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commitButWhyConfigAndRecordDefault, createGitRepo, repoRoot } from "../support/by-cli.js";
import { runTestProcess } from "../support/testProcess.js";

const processTimeoutMs = 30_000;
const decodeEventObjects = (stdout: string): readonly Record<string, unknown>[] =>
  stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Pi emitted a non-object JSON event.");
      }
      return parsed as Record<string, unknown>;
    });

describe("packaged Change Implement continuation extension process boundary", () => {
  it("aborts a real Pi turn after its tool batch when the installed Change is blocked", () => {
    const repositoryRoot = createGitRepo();
    const callsPath = join(repositoryRoot, "provider-calls.log");
    const initialized = runTestProcess("by", ["init", "--id-prefix", "BY"], {
      cwd: repositoryRoot,
      timeout: processTimeoutMs,
    });
    expect(initialized.status, initialized.stderr || initialized.stdout).toBe(0);
    commitButWhyConfigAndRecordDefault(repositoryRoot);

    const started = runTestProcess("by", ["change", "start"], {
      cwd: repositoryRoot,
      timeout: processTimeoutMs,
    });
    expect(started.status, started.stderr || started.stdout).toBe(0);
    const startedValue: unknown = JSON.parse(started.stdout);
    if (typeof startedValue !== "object" || startedValue === null || Array.isArray(startedValue)) {
      throw new Error("Installed Change Start returned a non-object result.");
    }
    const worktreePath = Reflect.get(startedValue, "worktreePath");
    if (typeof worktreePath !== "string") throw new Error("Change Start omitted worktreePath.");

    const blocker = runTestProcess("by", ["change", "blocker", "raise", "BY-C1", "--file", "-"], {
      cwd: worktreePath,
      input:
        "The Operator must approve the implementation direction.\nContinuing without that decision is unsafe.\n",
      timeout: processTimeoutMs,
    });
    expect(blocker.status, blocker.stderr || blocker.stdout).toBe(0);

    const pi = join(repoRoot, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
    const provider = join(repoRoot, "test/fixtures/pi/deterministic-tool-provider.mjs");
    const extension = join(repoRoot, "extensions/continue-change.ts");
    const run = runTestProcess(
      process.execPath,
      [
        pi,
        "--mode",
        "json",
        "--print",
        "--no-session",
        "--offline",
        "--no-extensions",
        "--no-context-files",
        "--no-skills",
        "--thinking",
        "off",
        "--tools",
        "bash",
        "--model",
        "but-why-test/deterministic-tool",
        "--extension",
        provider,
        "--extension",
        extension,
        "Change identity: BY-C1.",
      ],
      {
        cwd: worktreePath,
        env: { PI_TEST_PROVIDER_CALLS: callsPath },
        timeout: processTimeoutMs,
      },
    );

    expect(run.status, run.stderr || run.stdout).toBe(0);
    const events = decodeEventObjects(run.stdout);
    expect(events.filter((event) => event["type"] === "tool_execution_end")).toHaveLength(1);
    expect(events.some((event) => event["type"] === "turn_end")).toBe(true);
    expect(events.some((event) => event["type"] === "agent_end")).toBe(true);
    expect(readFileSync(callsPath, "utf8").trim().split("\n")).toEqual(["1"]);
  }, 30_000);
});
