import { describe, expect, it } from "vitest";

import {
  type HerdrCommandExecutor,
  herdrSessionName,
  openHerdrInteractiveSessionHost,
  trustedContinuationExtensionPath,
} from "../../src/change/interactiveSession/herdrInteractiveSessionHost.js";
import { resolvePackageAsset } from "../../src/change/packageAssetPath.js";

const systemPromptPaths = [
  resolvePackageAsset("docs/public/skills/but-why/references/command-guidance.md"),
  resolvePackageAsset("docs/public/skills/but-why/references/implement-change.md"),
] as const;

const emptyAgents = (): { readonly ok: true; readonly stdout: string } => ({
  ok: true,
  stdout: '{"result":{"type":"agent_list","agents":[]}}',
});

const openedWorktree = (): { readonly ok: true; readonly stdout: string } => ({
  ok: true,
  stdout:
    '{"result":{"type":"worktree_opened","workspace":{"workspace_id":"workspace-1"},"root_pane":{"pane_id":"pane-1"},"already_open":false}}',
});

const input = {
  changeId: "change-123",
  hostSessionName: herdrSessionName("change-123"),
  agentSessionName: "Change 123 descriptive name",
  repositoryPath: "/repository",
  worktreePath: "/workspace/change-123",
  systemPromptPaths,
  initialPrompt: "Change identity: change-123.\n\nManaged Worktree: /workspace/change-123.",
} as const;

describe("Herdr Interactive Session Host", () => {
  it("starts a named Pi agent natively and submits one complete handoff", async () => {
    const commands: readonly string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      (commands as string[][]).push([...args]);
      if (args[0] === "agent" && args[1] === "list") return emptyAgents();
      if (args[0] === "worktree" && args[1] === "open") return openedWorktree();
      if (args[0] === "agent" && args[1] === "start") {
        return { ok: true, stdout: '{"result":{"type":"agent_started","terminal_id":"t-1"}}' };
      }
      if (args[0] === "agent" && args[1] === "prompt") {
        return { ok: true, stdout: '{"result":{"type":"agent_prompted"}}' };
      }
      return { ok: false, message: `unexpected Herdr command: ${args.join(" ")}` };
    };

    await expect(openHerdrInteractiveSessionHost(execute).launch(input)).resolves.toEqual({
      ok: true,
      host: "herdr",
      status: "started",
    });

    expect(commands).toEqual([
      ["agent", "list"],
      [
        "worktree",
        "open",
        "--cwd",
        "/repository",
        "--path",
        "/workspace/change-123",
        "--label",
        herdrSessionName("change-123"),
        "--no-focus",
      ],
      ["agent", "list"],
      [
        "agent",
        "start",
        herdrSessionName("change-123"),
        "--kind",
        "pi",
        "--pane",
        "pane-1",
        "--timeout",
        "30000",
        "--",
        "--system-prompt",
        systemPromptPaths[0],
        "--append-system-prompt",
        systemPromptPaths[1],
        "--name",
        "Change 123 descriptive name",
        "--extension",
        trustedContinuationExtensionPath(),
      ],
      ["agent", "prompt", herdrSessionName("change-123"), input.initialPrompt],
    ]);

    const start = commands[3] ?? [];
    expect(start.join(" ")).not.toContain("# But Why");
    expect(start.join(" ")).not.toContain("The Implementer must");
  });

  it("retries only a definite busy pane and submits one prompt after native readiness", async () => {
    const commands: readonly string[][] = [];
    let startAttempts = 0;
    const execute: HerdrCommandExecutor = async (args) => {
      (commands as string[][]).push([...args]);
      if (args[0] === "agent" && args[1] === "list") return emptyAgents();
      if (args[0] === "worktree" && args[1] === "open") return openedWorktree();
      if (args[0] === "agent" && args[1] === "start") {
        startAttempts += 1;
        if (startAttempts === 1) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return { ok: false, message: "agent_pane_busy: pane shell is still starting" };
        }
        return { ok: true, stdout: '{"result":{"type":"agent_started","terminal_id":"t-1"}}' };
      }
      if (args[0] === "agent" && args[1] === "prompt") {
        return { ok: true, stdout: '{"result":{"type":"agent_prompted"}}' };
      }
      return { ok: false, message: `unexpected Herdr command: ${args.join(" ")}` };
    };

    await expect(
      openHerdrInteractiveSessionHost(execute, {
        commandTimeoutMs: 5,
        readinessTimeoutMs: 250,
      }).launch(input),
    ).resolves.toEqual({
      ok: true,
      host: "herdr",
      status: "started",
    });

    expect(commands.filter((args) => args[0] === "agent" && args[1] === "start")).toHaveLength(2);
    expect(commands.filter((args) => args[0] === "agent" && args[1] === "prompt")).toHaveLength(1);
  });

  it("stops permanent pane-busy readiness with an actionable pane failure", async () => {
    const commands: readonly string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      (commands as string[][]).push([...args]);
      if (args[0] === "agent" && args[1] === "list") return emptyAgents();
      if (args[0] === "worktree" && args[1] === "open") return openedWorktree();
      if (args[0] === "agent" && args[1] === "start")
        return { ok: false, message: "agent_pane_busy: pane shell is still starting" };
      return { ok: false, message: `unexpected Herdr command: ${args.join(" ")}` };
    };

    await expect(
      openHerdrInteractiveSessionHost(execute, { readinessTimeoutMs: 120 }).launch(input),
    ).resolves.toMatchObject({
      ok: false,
      code: "pane_not_ready",
      message: expect.stringContaining("pane shell did not become ready"),
    });
    expect(
      commands.filter((args) => args[0] === "agent" && args[1] === "start").length,
    ).toBeGreaterThan(1);
    expect(commands.some((args) => args[0] === "agent" && args[1] === "prompt")).toBe(false);
  });

  it("passes selected Pi model, thinking, tools, and context settings to native start", async () => {
    const commands: readonly string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      (commands as string[][]).push([...args]);
      if (args[0] === "agent" && args[1] === "list") return emptyAgents();
      if (args[0] === "worktree" && args[1] === "open") return openedWorktree();
      if (args[0] === "agent" && args[1] === "start") {
        return { ok: true, stdout: '{"result":{"type":"agent_started","terminal_id":"t-1"}}' };
      }
      if (args[0] === "agent" && args[1] === "prompt") {
        return { ok: true, stdout: '{"result":{"type":"agent_prompted"}}' };
      }
      return { ok: false, message: `unexpected Herdr command: ${args.join(" ")}` };
    };

    await expect(
      openHerdrInteractiveSessionHost(execute).launch({
        ...input,
        globalConfigDirectory: "/global-config",
        agentProfile: {
          agentProfile: "implementation",
          scope: "global",
          globalConfigDirectory: "/global-config",
          profile: {
            agentRuntime: "pi",
            runtimeConfig: {
              model: "model-x",
              thinking: "high",
              tools: ["read"],
              contextFileDiscovery: false,
            },
          },
        },
      }),
    ).resolves.toMatchObject({ ok: true, status: "started" });

    const start = commands.find((args) => args[0] === "agent" && args[1] === "start");
    expect(start).toEqual(
      expect.arrayContaining([
        "--model",
        "model-x",
        "--thinking",
        "high",
        "--tools",
        "read",
        "--no-context-files",
      ]),
    );
  });

  it("does not start or prompt another agent when the named session is active", async () => {
    const commands: readonly string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      (commands as string[][]).push([...args]);
      return {
        ok: true,
        stdout: `{"result":{"type":"agent_list","agents":[{"name":"${input.hostSessionName}","cwd":"${input.worktreePath}","pane_id":"pane-1","agent_status":"working"}]}}`,
      };
    };

    await expect(openHerdrInteractiveSessionHost(execute).launch(input)).resolves.toEqual({
      ok: true,
      host: "herdr",
      status: "already_active",
    });
    expect(commands).toEqual([["agent", "list"]]);
  });

  it("does not start when another unknown agent occupies the Managed Worktree", async () => {
    const commands: string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      commands.push([...args]);
      return {
        ok: true,
        stdout:
          '{"result":{"type":"agent_list","agents":[{"name":"other-session","cwd":"/workspace/change-123","pane_id":"pane-2","agent_status":"unknown"}]}}',
      };
    };

    await expect(openHerdrInteractiveSessionHost(execute).launch(input)).resolves.toMatchObject({
      ok: false,
      code: "launch_indeterminate",
    });
    expect(commands).toEqual([["agent", "list"]]);
  });

  it("does not prompt after a definite native start failure", async () => {
    const commands: string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      commands.push([...args]);
      if (args[0] === "agent" && args[1] === "list") return emptyAgents();
      if (args[0] === "worktree") return openedWorktree();
      if (args[0] === "agent" && args[1] === "start") {
        return { ok: false, message: "agent pane is not available" };
      }
      return { ok: false, message: "unexpected Herdr command" };
    };

    await expect(openHerdrInteractiveSessionHost(execute).launch(input)).resolves.toMatchObject({
      ok: false,
      code: "launch_failed",
    });
    expect(commands.at(-1)?.slice(0, 2)).toEqual(["agent", "start"]);
    expect(commands.some((args) => args[0] === "agent" && args[1] === "prompt")).toBe(false);
  });

  it("observes an uncertain native start and never retries it", async () => {
    const commands: string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      commands.push([...args]);
      if (args[0] === "agent" && args[1] === "list") return emptyAgents();
      if (args[0] === "worktree") return openedWorktree();
      if (args[0] === "agent" && args[1] === "start") {
        return { ok: false, message: "response lost" };
      }
      return { ok: false, message: "unexpected retry" };
    };

    await expect(
      openHerdrInteractiveSessionHost(execute, { commandTimeoutMs: 20 }).launch(input),
    ).resolves.toMatchObject({ ok: false, code: "launch_indeterminate" });
    expect(commands.filter((args) => args[0] === "agent" && args[1] === "start")).toHaveLength(1);
    expect(commands.at(-1)).toEqual(["agent", "list"]);
  });

  it("observes an uncertain initial prompt without replaying it", async () => {
    const commands: string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      commands.push([...args]);
      if (args[0] === "agent" && args[1] === "list") return emptyAgents();
      if (args[0] === "worktree") return openedWorktree();
      if (args[0] === "agent" && args[1] === "start") {
        return { ok: true, stdout: '{"result":{"type":"agent_started","terminal_id":"t-1"}}' };
      }
      if (args[0] === "agent" && args[1] === "prompt") {
        return { ok: false, message: "response lost" };
      }
      return { ok: false, message: "unexpected prompt retry" };
    };

    await expect(openHerdrInteractiveSessionHost(execute).launch(input)).resolves.toMatchObject({
      ok: false,
      code: "launch_indeterminate",
    });
    expect(commands.filter((args) => args[0] === "agent" && args[1] === "prompt")).toHaveLength(1);
    expect(commands.at(-1)).toEqual(["agent", "list"]);
  });
});
