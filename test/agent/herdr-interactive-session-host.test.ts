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
  stdout: '{"result":{"type":"agent_list","agents":[],"future_field":true}}',
});

const openedWorktree = (): { readonly ok: true; readonly stdout: string } => ({
  ok: true,
  stdout:
    '{"result":{"type":"worktree_opened","worktree":{"path":"/workspace/change-123","open_workspace_id":"workspace-1","branch":null,"future_field":true},"workspace":{"workspace_id":"workspace-1","worktree":{"checkout_path":"/workspace/change-123","future_field":true},"future_field":true},"tab":{"tab_id":"tab-1","workspace_id":"workspace-1","future_field":true},"root_pane":{"pane_id":"pane-1","workspace_id":"workspace-1","tab_id":"tab-1","future_field":true},"already_open":false,"future_field":true}}',
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
        return {
          ok: true,
          stdout:
            '{"result":{"type":"agent_started","agent":{"terminal_id":"t-1"},"future_field":true}}',
        };
      }
      if (args[0] === "agent" && args[1] === "prompt") {
        return { ok: true, stdout: '{"result":{"type":"agent_prompted","future_field":true}}' };
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
        "120000",
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
          return {
            ok: false,
            message:
              '{"error":{"code":"agent_pane_busy","message":"pane shell is still starting"}}',
          };
        }
        return {
          ok: true,
          stdout: '{"result":{"type":"agent_started","agent":{"terminal_id":"t-1"}}}',
        };
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
        return {
          ok: false,
          message: '{"error":{"code":"agent_pane_busy","message":"pane shell is still starting"}}',
        };
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
        return {
          ok: true,
          stdout: '{"result":{"type":"agent_started","agent":{"terminal_id":"t-1"}}}',
        };
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

  it("accepts a worktree-list confirmation with unknown fields after an uncertain open", async () => {
    const commands: string[][] = [];
    let openAttempts = 0;
    const execute: HerdrCommandExecutor = async (args) => {
      commands.push([...args]);
      if (args[0] === "agent" && args[1] === "list") return emptyAgents();
      if (args[0] === "worktree" && args[1] === "open") {
        openAttempts += 1;
        return openAttempts === 1 ? { ok: false, message: "response lost" } : openedWorktree();
      }
      if (args[0] === "worktree" && args[1] === "list") {
        return {
          ok: true,
          stdout:
            '{"result":{"type":"worktree_list","worktrees":[{"path":"/detached-one","branch":"other"},{"path":"/workspace/change-123","branch":null,"future_field":true}],"future_field":true}}',
        };
      }
      if (args[0] === "agent" && args[1] === "start") {
        return {
          ok: true,
          stdout: '{"result":{"type":"agent_started","agent":{"terminal_id":"t-1"}}}',
        };
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
    expect(commands.filter((args) => args[0] === "worktree" && args[1] === "open")).toHaveLength(2);
  });

  it("does not confirm a worktree from a list containing an entry without a path", async () => {
    const commands: string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      commands.push([...args]);
      if (args[0] === "agent") return emptyAgents();
      if (args[0] === "worktree" && args[1] === "open") {
        return { ok: false, message: "response lost" };
      }
      return {
        ok: true,
        stdout:
          '{"result":{"type":"worktree_list","worktrees":[{"branch":null},{"path":"/workspace/change-123","branch":"change-123"}]}}',
      };
    };

    await expect(openHerdrInteractiveSessionHost(execute).launch(input)).resolves.toMatchObject({
      ok: false,
      code: "launch_indeterminate",
    });
    expect(commands.filter((args) => args[0] === "worktree" && args[1] === "open")).toHaveLength(1);
  });

  it.each([
    ["invalid JSON syntax", "{"],
    ["an array response", "[]"],
    ["an array result", '{"result":[]}'],
    ["the wrong family", '{"result":{"type":"worktree_list","agents":[]}}'],
    ["a missing required field", '{"result":{"type":"agent_list"}}'],
    [
      "a malformed agent",
      '{"result":{"type":"agent_list","agents":[{"cwd":"/workspace/change-123","pane_id":"pane-1"}]}}',
    ],
  ])("does not affirm existing session state from %s", async (_description, stdout) => {
    const execute: HerdrCommandExecutor = async () => ({ ok: true, stdout });

    await expect(openHerdrInteractiveSessionHost(execute).launch(input)).resolves.toMatchObject({
      ok: false,
      code: "launch_failed",
    });
  });

  it.each([
    [
      "worktree_opened",
      '{"result":{"type":"worktree_opened","workspace":{},"root_pane":{"pane_id":"pane-1"}}}',
    ],
    ["agent_started", '{"result":{"type":"agent_started","agent":{"terminal_id":[]}}}'],
    ["agent_prompted", '{"result":{"type":"agent_started","agent":{"terminal_id":"t-1"}}}'],
  ])("does not affirm a malformed %s mutation response", async (family, malformed) => {
    const execute: HerdrCommandExecutor = async (args) => {
      if (args[0] === "agent" && args[1] === "list") return emptyAgents();
      if (args[0] === "worktree") {
        return family === "worktree_opened" ? { ok: true, stdout: malformed } : openedWorktree();
      }
      if (args[0] === "agent" && args[1] === "start") {
        return family === "agent_started"
          ? { ok: true, stdout: malformed }
          : {
              ok: true,
              stdout: '{"result":{"type":"agent_started","agent":{"terminal_id":"t-1"}}}',
            };
      }
      return { ok: true, stdout: malformed };
    };

    await expect(openHerdrInteractiveSessionHost(execute).launch(input)).resolves.toMatchObject({
      ok: false,
      code: "launch_indeterminate",
    });
  });

  it.each([
    [
      "a missing worktree",
      '{"workspace":{"workspace_id":"workspace-1","worktree":{"checkout_path":"/workspace/change-123"}},"tab":{"tab_id":"tab-1","workspace_id":"workspace-1"},"root_pane":{"pane_id":"pane-1","workspace_id":"workspace-1","tab_id":"tab-1"},"already_open":false}',
    ],
    [
      "the wrong worktree path",
      '{"worktree":{"path":"/workspace/other","open_workspace_id":"workspace-1"},"workspace":{"workspace_id":"workspace-1","worktree":{"checkout_path":"/workspace/change-123"}},"tab":{"tab_id":"tab-1","workspace_id":"workspace-1"},"root_pane":{"pane_id":"pane-1","workspace_id":"workspace-1","tab_id":"tab-1"},"already_open":false}',
    ],
    [
      "a missing workspace",
      '{"worktree":{"path":"/workspace/change-123","open_workspace_id":"workspace-1"},"tab":{"tab_id":"tab-1","workspace_id":"workspace-1"},"root_pane":{"pane_id":"pane-1","workspace_id":"workspace-1","tab_id":"tab-1"},"already_open":false}',
    ],
    [
      "a missing workspace worktree",
      '{"worktree":{"path":"/workspace/change-123","open_workspace_id":"workspace-1"},"workspace":{"workspace_id":"workspace-1"},"tab":{"tab_id":"tab-1","workspace_id":"workspace-1"},"root_pane":{"pane_id":"pane-1","workspace_id":"workspace-1","tab_id":"tab-1"},"already_open":false}',
    ],
    [
      "the wrong workspace checkout path",
      '{"worktree":{"path":"/workspace/change-123","open_workspace_id":"workspace-1"},"workspace":{"workspace_id":"workspace-1","worktree":{"checkout_path":"/workspace/other"}},"tab":{"tab_id":"tab-1","workspace_id":"workspace-1"},"root_pane":{"pane_id":"pane-1","workspace_id":"workspace-1","tab_id":"tab-1"},"already_open":false}',
    ],
    [
      "an empty workspace identifier",
      '{"worktree":{"path":"/workspace/change-123","open_workspace_id":""},"workspace":{"workspace_id":"","worktree":{"checkout_path":"/workspace/change-123"}},"tab":{"tab_id":"tab-1","workspace_id":""},"root_pane":{"pane_id":"pane-1","workspace_id":"","tab_id":"tab-1"},"already_open":false}',
    ],
    [
      "a mismatched worktree workspace",
      '{"worktree":{"path":"/workspace/change-123","open_workspace_id":"workspace-2"},"workspace":{"workspace_id":"workspace-1","worktree":{"checkout_path":"/workspace/change-123"}},"tab":{"tab_id":"tab-1","workspace_id":"workspace-1"},"root_pane":{"pane_id":"pane-1","workspace_id":"workspace-1","tab_id":"tab-1"},"already_open":false}',
    ],
    [
      "a missing tab",
      '{"worktree":{"path":"/workspace/change-123","open_workspace_id":"workspace-1"},"workspace":{"workspace_id":"workspace-1","worktree":{"checkout_path":"/workspace/change-123"}},"root_pane":{"pane_id":"pane-1","workspace_id":"workspace-1","tab_id":"tab-1"},"already_open":false}',
    ],
    [
      "an empty tab identifier",
      '{"worktree":{"path":"/workspace/change-123","open_workspace_id":"workspace-1"},"workspace":{"workspace_id":"workspace-1","worktree":{"checkout_path":"/workspace/change-123"}},"tab":{"tab_id":"","workspace_id":"workspace-1"},"root_pane":{"pane_id":"pane-1","workspace_id":"workspace-1","tab_id":""},"already_open":false}',
    ],
    [
      "a tab in another workspace",
      '{"worktree":{"path":"/workspace/change-123","open_workspace_id":"workspace-1"},"workspace":{"workspace_id":"workspace-1","worktree":{"checkout_path":"/workspace/change-123"}},"tab":{"tab_id":"tab-1","workspace_id":"workspace-2"},"root_pane":{"pane_id":"pane-1","workspace_id":"workspace-1","tab_id":"tab-1"},"already_open":false}',
    ],
    [
      "a missing root pane",
      '{"worktree":{"path":"/workspace/change-123","open_workspace_id":"workspace-1"},"workspace":{"workspace_id":"workspace-1","worktree":{"checkout_path":"/workspace/change-123"}},"tab":{"tab_id":"tab-1","workspace_id":"workspace-1"},"already_open":false}',
    ],
    [
      "an empty root-pane identifier",
      '{"worktree":{"path":"/workspace/change-123","open_workspace_id":"workspace-1"},"workspace":{"workspace_id":"workspace-1","worktree":{"checkout_path":"/workspace/change-123"}},"tab":{"tab_id":"tab-1","workspace_id":"workspace-1"},"root_pane":{"pane_id":"","workspace_id":"workspace-1","tab_id":"tab-1"},"already_open":false}',
    ],
    [
      "a root pane in another workspace",
      '{"worktree":{"path":"/workspace/change-123","open_workspace_id":"workspace-1"},"workspace":{"workspace_id":"workspace-1","worktree":{"checkout_path":"/workspace/change-123"}},"tab":{"tab_id":"tab-1","workspace_id":"workspace-1"},"root_pane":{"pane_id":"pane-1","workspace_id":"workspace-2","tab_id":"tab-1"},"already_open":false}',
    ],
    [
      "a root pane in another tab",
      '{"worktree":{"path":"/workspace/change-123","open_workspace_id":"workspace-1"},"workspace":{"workspace_id":"workspace-1","worktree":{"checkout_path":"/workspace/change-123"}},"tab":{"tab_id":"tab-1","workspace_id":"workspace-1"},"root_pane":{"pane_id":"pane-1","workspace_id":"workspace-1","tab_id":"tab-2"},"already_open":false}',
    ],
    [
      "a missing already-open flag",
      '{"worktree":{"path":"/workspace/change-123","open_workspace_id":"workspace-1"},"workspace":{"workspace_id":"workspace-1","worktree":{"checkout_path":"/workspace/change-123"}},"tab":{"tab_id":"tab-1","workspace_id":"workspace-1"},"root_pane":{"pane_id":"pane-1","workspace_id":"workspace-1","tab_id":"tab-1"}}',
    ],
    [
      "a malformed already-open flag",
      '{"worktree":{"path":"/workspace/change-123","open_workspace_id":"workspace-1"},"workspace":{"workspace_id":"workspace-1","worktree":{"checkout_path":"/workspace/change-123"}},"tab":{"tab_id":"tab-1","workspace_id":"workspace-1"},"root_pane":{"pane_id":"pane-1","workspace_id":"workspace-1","tab_id":"tab-1"},"already_open":"false"}',
    ],
  ])("rejects worktree-open output with %s before starting or prompting", async (_description, body) => {
    const commands: string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      commands.push([...args]);
      if (args[0] === "agent" && args[1] === "list") return emptyAgents();
      return {
        ok: true,
        stdout: `{"result":{"type":"worktree_opened",${body.slice(1)}}`,
      };
    };

    await expect(openHerdrInteractiveSessionHost(execute).launch(input)).resolves.toMatchObject({
      ok: false,
      code: "launch_indeterminate",
    });
    expect(commands.some((args) => args[0] === "agent" && args[1] === "start")).toBe(false);
    expect(commands.some((args) => args[0] === "agent" && args[1] === "prompt")).toBe(false);
  });

  it("does not retry a malformed agent-pane-busy error envelope", async () => {
    const commands: string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      commands.push([...args]);
      if (args[0] === "agent" && args[1] === "list") return emptyAgents();
      if (args[0] === "worktree") return openedWorktree();
      return { ok: false, message: '{"error":[]}' };
    };

    await expect(openHerdrInteractiveSessionHost(execute).launch(input)).resolves.toMatchObject({
      ok: false,
      code: "launch_failed",
    });
    expect(commands.filter((args) => args[0] === "agent" && args[1] === "start")).toHaveLength(1);
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
        return {
          ok: true,
          stdout: '{"result":{"type":"agent_started","agent":{"terminal_id":"t-1"}}}',
        };
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
