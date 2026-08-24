import { describe, expect, it } from "vitest";
import type { HerdrAgentPromptTransport } from "../../src/change/interactiveSession/adapters/herdrAgentPromptSocket.js";
import {
  type HerdrCommandExecutor,
  type HerdrInteractiveSessionHostOptions,
  herdrSessionName,
  openHerdrInteractiveSessionHost as openRawHerdrInteractiveSessionHost,
  trustedContinuationExtensionPath,
} from "../../src/change/interactiveSession/adapters/herdrInteractiveSessionHost.js";
import { resolvePackageAsset } from "../../src/change/packageAssetPath.js";

const systemPromptPaths = [
  resolvePackageAsset("docs/public/skills/but-why/references/command-guidance.md"),
  resolvePackageAsset("docs/public/skills/but-why/references/implement-change.md"),
] as const;

const emptyAgents = (): { readonly ok: true; readonly stdout: string } => ({
  ok: true,
  stdout:
    '{"result":{"type":"agent_list","agents":[],"future_field":true},"future_response_field":true}',
});

const emptyWorkspaces = (): { readonly ok: true; readonly stdout: string } => ({
  ok: true,
  stdout:
    '{"result":{"type":"workspace_list","workspaces":[],"future_field":true},"future_response_field":true}',
});

const createdWorkspace = (): { readonly ok: true; readonly stdout: string } => ({
  ok: true,
  stdout:
    '{"result":{"type":"workspace_created","workspace":{"workspace_id":"workspace-1","label":"change-123","future_field":true},"tab":{"tab_id":"tab-1","workspace_id":"workspace-1","future_field":true},"root_pane":{"pane_id":"pane-1","workspace_id":"workspace-1","tab_id":"tab-1","cwd":"/workspace/change-123","future_field":true},"future_field":true},"future_response_field":true}',
});

const input = {
  changeId: "change-123",
  hostSessionName: herdrSessionName("change-123"),
  worktreePath: "/workspace/change-123",
  systemPromptPaths,
  initialPrompt: "Change identity: change-123.\n\nManaged Worktree: /workspace/change-123.",
} as const;

const listedAgents = (
  agents: readonly Readonly<Record<string, string>>[],
): { readonly ok: true; readonly stdout: string } => ({
  ok: true,
  stdout: JSON.stringify({ result: { type: "agent_list", agents } }),
});

const matchingAgent = (status: string) => ({
  name: input.hostSessionName,
  cwd: input.worktreePath,
  workspace_id: "workspace-1",
  pane_id: "pane-1",
  agent_status: status,
});

const confirmedPromptTransport: HerdrAgentPromptTransport = async () => ({ ok: true });

const openHerdrInteractiveSessionHost = (
  execute: HerdrCommandExecutor,
  options: HerdrInteractiveSessionHostOptions = {},
) =>
  openRawHerdrInteractiveSessionHost(execute, {
    platform: "linux",
    ...options,
    promptTransport: options.promptTransport ?? confirmedPromptTransport,
  });

describe("Herdr Interactive Session Host", () => {
  it("starts a named Pi agent natively and submits one complete handoff", async () => {
    const commands: readonly string[][] = [];
    const prompts: Parameters<HerdrAgentPromptTransport>[0][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      (commands as string[][]).push([...args]);
      if (args[0] === "agent" && args[1] === "list") return emptyAgents();
      if (args[0] === "workspace" && args[1] === "list") return emptyWorkspaces();
      if (args[0] === "workspace" && args[1] === "create") return createdWorkspace();
      if (args[0] === "agent" && args[1] === "start") {
        return {
          ok: true,
          stdout:
            '{"result":{"type":"agent_started","agent":{"terminal_id":"t-1"},"future_field":true}}',
        };
      }
      return { ok: false, message: `unexpected Herdr command: ${args.join(" ")}` };
    };
    const promptTransport: HerdrAgentPromptTransport = async (prompt) => {
      prompts.push(prompt);
      return { ok: true };
    };

    await expect(
      openHerdrInteractiveSessionHost(execute, { promptTransport }).launch(input),
    ).resolves.toEqual({
      ok: true,
      host: "herdr",
      status: "started",
    });

    expect(commands).toEqual([
      ["agent", "list"],
      ["workspace", "list"],
      [
        "workspace",
        "create",
        "--cwd",
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
        "--append-system-prompt",
        systemPromptPaths[0],
        "--append-system-prompt",
        systemPromptPaths[1],
        "--name",
        "change-123",
        "--extension",
        trustedContinuationExtensionPath(),
      ],
    ]);
    expect(prompts).toEqual([
      expect.objectContaining({
        target: herdrSessionName("change-123"),
        text: input.initialPrompt,
        timeoutMs: 5_000,
      }),
    ]);

    const start = commands[4] ?? [];
    expect(start.join(" ")).not.toContain("# But Why");
    expect(start.join(" ")).not.toContain("The Implementer must");
  });

  it("retries only a definite busy pane and submits one prompt after native readiness", async () => {
    const commands: readonly string[][] = [];
    let startAttempts = 0;
    let promptAttempts = 0;
    const execute: HerdrCommandExecutor = async (args) => {
      (commands as string[][]).push([...args]);
      if (args[0] === "agent" && args[1] === "list") return emptyAgents();
      if (args[0] === "workspace" && args[1] === "list") return emptyWorkspaces();
      if (args[0] === "workspace" && args[1] === "create") return createdWorkspace();
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
      return { ok: false, message: `unexpected Herdr command: ${args.join(" ")}` };
    };

    await expect(
      openHerdrInteractiveSessionHost(execute, {
        commandTimeoutMs: 5,
        readinessTimeoutMs: 250,
        promptTransport: async () => {
          promptAttempts += 1;
          return { ok: true };
        },
      }).launch(input),
    ).resolves.toEqual({
      ok: true,
      host: "herdr",
      status: "started",
    });

    expect(commands.filter((args) => args[0] === "agent" && args[1] === "start")).toHaveLength(2);
    expect(promptAttempts).toBe(1);
    expect(commands.some((args) => args[0] === "agent" && args[1] === "prompt")).toBe(false);
  });

  it("stops permanent pane-busy readiness with an actionable pane failure", async () => {
    const commands: readonly string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      (commands as string[][]).push([...args]);
      if (args[0] === "agent" && args[1] === "list") return emptyAgents();
      if (args[0] === "workspace" && args[1] === "list") return emptyWorkspaces();
      if (args[0] === "workspace" && args[1] === "create") return createdWorkspace();
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
      if (args[0] === "workspace" && args[1] === "list") return emptyWorkspaces();
      if (args[0] === "workspace" && args[1] === "create") return createdWorkspace();
      if (args[0] === "agent" && args[1] === "start") {
        return {
          ok: true,
          stdout: '{"result":{"type":"agent_started","agent":{"terminal_id":"t-1"}}}',
        };
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

  it("recovers one newly created labeled workspace after an uncertain response", async () => {
    const commands: string[][] = [];
    let workspaceObservations = 0;
    const execute: HerdrCommandExecutor = async (args) => {
      commands.push([...args]);
      if (args[0] === "agent" && args[1] === "list") return emptyAgents();
      if (args[0] === "workspace" && args[1] === "list") {
        workspaceObservations += 1;
        return workspaceObservations === 1
          ? emptyWorkspaces()
          : {
              ok: true,
              stdout: `{"result":{"type":"workspace_list","workspaces":[{"workspace_id":"workspace-1","label":"${input.hostSessionName}","future_field":true}]}}`,
            };
      }
      if (args[0] === "workspace" && args[1] === "create") {
        return { ok: false, message: "response lost" };
      }
      if (args[0] === "pane" && args[1] === "list") {
        return {
          ok: true,
          stdout:
            '{"result":{"type":"pane_list","panes":[{"pane_id":"pane-1","workspace_id":"workspace-1","cwd":"/workspace/change-123","future_field":true}]}}',
        };
      }
      if (args[0] === "agent" && args[1] === "start") {
        return {
          ok: true,
          stdout: '{"result":{"type":"agent_started","agent":{"terminal_id":"t-1"}}}',
        };
      }
      return { ok: false, message: `unexpected Herdr command: ${args.join(" ")}` };
    };

    await expect(openHerdrInteractiveSessionHost(execute).launch(input)).resolves.toEqual({
      ok: true,
      host: "herdr",
      status: "started",
    });
    expect(commands.filter((args) => args[0] === "workspace" && args[1] === "create")).toHaveLength(
      1,
    );
    expect(commands).toContainEqual(["pane", "list", "--workspace", "workspace-1"]);
  });

  it("reuses one existing labeled workspace instead of creating a duplicate", async () => {
    const commands: string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      commands.push([...args]);
      if (args[0] === "agent" && args[1] === "list") return emptyAgents();
      if (args[0] === "workspace" && args[1] === "list") {
        return {
          ok: true,
          stdout: `{"result":{"type":"workspace_list","workspaces":[{"workspace_id":"workspace-1","label":"${input.hostSessionName}"}]}}`,
        };
      }
      if (args[0] === "pane" && args[1] === "list") {
        return {
          ok: true,
          stdout:
            '{"result":{"type":"pane_list","panes":[{"pane_id":"pane-1","workspace_id":"workspace-1","cwd":"/workspace/change-123"}]}}',
        };
      }
      if (args[0] === "agent" && args[1] === "start") {
        return {
          ok: true,
          stdout: '{"result":{"type":"agent_started","agent":{"terminal_id":"t-1"}}}',
        };
      }
      return { ok: false, message: `unexpected Herdr command: ${args.join(" ")}` };
    };

    await expect(openHerdrInteractiveSessionHost(execute).launch(input)).resolves.toEqual({
      ok: true,
      host: "herdr",
      status: "started",
    });
    expect(commands.some((args) => args[0] === "workspace" && args[1] === "create")).toBe(false);
  });

  it("does not reuse a same-label workspace at another cwd", async () => {
    const commands: string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      commands.push([...args]);
      if (args[0] === "agent" && args[1] === "list") return emptyAgents();
      if (args[0] === "workspace" && args[1] === "list") {
        return {
          ok: true,
          stdout: `{"result":{"type":"workspace_list","workspaces":[{"workspace_id":"workspace-other","label":"${input.hostSessionName}"}]}}`,
        };
      }
      if (args[0] === "pane" && args[1] === "list") {
        return {
          ok: true,
          stdout:
            '{"result":{"type":"pane_list","panes":[{"pane_id":"pane-other","workspace_id":"workspace-other","cwd":"/workspace/other"}]}}',
        };
      }
      return { ok: false, message: `unexpected Herdr command: ${args.join(" ")}` };
    };

    await expect(openHerdrInteractiveSessionHost(execute).launch(input)).resolves.toMatchObject({
      ok: false,
      code: "launch_indeterminate",
    });
    expect(commands.some((args) => args[0] === "workspace" && args[1] === "create")).toBe(false);
  });

  it("does not guess after an uncertain create produces ambiguous labeled workspaces", async () => {
    let workspaceObservations = 0;
    const execute: HerdrCommandExecutor = async (args) => {
      if (args[0] === "agent" && args[1] === "list") return emptyAgents();
      if (args[0] === "workspace" && args[1] === "create") {
        return { ok: false, message: "response lost" };
      }
      if (args[0] === "workspace" && args[1] === "list") {
        workspaceObservations += 1;
        return workspaceObservations === 1
          ? emptyWorkspaces()
          : {
              ok: true,
              stdout: `{"result":{"type":"workspace_list","workspaces":[{"workspace_id":"workspace-1","label":"${input.hostSessionName}"},{"workspace_id":"workspace-2","label":"${input.hostSessionName}"}]}}`,
            };
      }
      return { ok: false, message: "unexpected observation" };
    };

    await expect(openHerdrInteractiveSessionHost(execute).launch(input)).resolves.toMatchObject({
      ok: false,
      code: "launch_indeterminate",
    });
  });

  it.each([
    ["invalid JSON syntax", "{"],
    ["an array response", "[]"],
    ["an array result", '{"result":[]}'],
    ["the wrong family", '{"result":{"type":"workspace_list","agents":[]}}'],
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
      "workspace_created",
      '{"result":{"type":"workspace_created","workspace":{},"root_pane":{"pane_id":"pane-1"}}}',
    ],
    ["agent_started", '{"result":{"type":"agent_started","agent":{"terminal_id":[]}}}'],
  ])("does not affirm a malformed %s mutation response", async (family, malformed) => {
    const execute: HerdrCommandExecutor = async (args) => {
      if (args[0] === "agent" && args[1] === "list") return emptyAgents();
      if (args[0] === "workspace" && args[1] === "list") return emptyWorkspaces();
      if (args[0] === "workspace" && args[1] === "create") {
        return family === "workspace_created"
          ? { ok: true, stdout: malformed }
          : createdWorkspace();
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
      "a missing tab",
      '{"workspace":{"workspace_id":"workspace-1"},"root_pane":{"pane_id":"pane-1","workspace_id":"workspace-1","tab_id":"tab-1","cwd":"/workspace/change-123"}}',
    ],
    [
      "a tab in another workspace",
      '{"workspace":{"workspace_id":"workspace-1"},"tab":{"tab_id":"tab-1","workspace_id":"workspace-2"},"root_pane":{"pane_id":"pane-1","workspace_id":"workspace-1","tab_id":"tab-1","cwd":"/workspace/change-123"}}',
    ],
    [
      "a root pane in another workspace",
      '{"workspace":{"workspace_id":"workspace-1"},"tab":{"tab_id":"tab-1","workspace_id":"workspace-1"},"root_pane":{"pane_id":"pane-1","workspace_id":"workspace-2","tab_id":"tab-1","cwd":"/workspace/change-123"}}',
    ],
    [
      "a root pane in another tab",
      '{"workspace":{"workspace_id":"workspace-1"},"tab":{"tab_id":"tab-1","workspace_id":"workspace-1"},"root_pane":{"pane_id":"pane-1","workspace_id":"workspace-1","tab_id":"tab-2","cwd":"/workspace/change-123"}}',
    ],
    [
      "a root pane at another cwd",
      '{"workspace":{"workspace_id":"workspace-1"},"tab":{"tab_id":"tab-1","workspace_id":"workspace-1"},"root_pane":{"pane_id":"pane-1","workspace_id":"workspace-1","tab_id":"tab-1","cwd":"/workspace/other"}}',
    ],
  ])("rejects workspace-create output with %s before starting or prompting", async (_description, body) => {
    const commands: string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      commands.push([...args]);
      if (args[0] === "agent" && args[1] === "list") return emptyAgents();
      if (args[0] === "workspace" && args[1] === "list") return emptyWorkspaces();
      return {
        ok: true,
        stdout: `{"result":{"type":"workspace_created",${body.slice(1)}}`,
      };
    };

    await expect(openHerdrInteractiveSessionHost(execute).launch(input)).resolves.toMatchObject({
      ok: false,
      code: "launch_indeterminate",
    });
    expect(commands.some((args) => args[0] === "agent" && args[1] === "start")).toBe(false);
  });

  it("does not retry a malformed agent-pane-busy error envelope", async () => {
    const commands: string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      commands.push([...args]);
      if (args[0] === "agent" && args[1] === "list") return emptyAgents();
      if (args[0] === "workspace" && args[1] === "list") return emptyWorkspaces();
      if (args[0] === "workspace" && args[1] === "create") return createdWorkspace();
      return { ok: false, message: '{"error":[]}' };
    };

    await expect(openHerdrInteractiveSessionHost(execute).launch(input)).resolves.toMatchObject({
      ok: false,
      code: "launch_failed",
    });
    expect(commands.filter((args) => args[0] === "agent" && args[1] === "start")).toHaveLength(1);
  });

  it("prompts an existing named done session instead of starting another agent", async () => {
    const commands: readonly string[][] = [];
    const prompts: Parameters<HerdrAgentPromptTransport>[0][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      (commands as string[][]).push([...args]);
      if (args[0] === "agent" && args[1] === "list") {
        return {
          ok: true,
          stdout: `{"result":{"type":"agent_list","agents":[{"name":"${input.hostSessionName}","cwd":"${input.worktreePath}","workspace_id":"workspace-1","pane_id":"pane-1","agent_status":"done"}]}}`,
        };
      }
      return { ok: false, message: `unexpected Herdr command: ${args.join(" ")}` };
    };

    await expect(
      openHerdrInteractiveSessionHost(execute, {
        promptTransport: async (prompt) => {
          prompts.push(prompt);
          return { ok: true };
        },
      }).launch(input),
    ).resolves.toEqual({
      ok: true,
      host: "herdr",
      status: "started",
    });
    expect(commands).toEqual([["agent", "list"]]);
    expect(prompts).toEqual([
      expect.objectContaining({
        target: input.hostSessionName,
        text: input.initialPrompt,
      }),
    ]);
  });

  it("prompts a matching done session observed after creating the workspace", async () => {
    const commands: string[][] = [];
    let observations = 0;
    let promptAttempts = 0;
    const execute: HerdrCommandExecutor = async (args) => {
      commands.push([...args]);
      if (args[0] === "agent" && args[1] === "list") {
        observations += 1;
        return observations === 1 ? emptyAgents() : listedAgents([matchingAgent("done")]);
      }
      if (args[0] === "workspace" && args[1] === "list") return emptyWorkspaces();
      if (args[0] === "workspace" && args[1] === "create") return createdWorkspace();
      return { ok: false, message: `unexpected Herdr command: ${args.join(" ")}` };
    };

    await expect(
      openHerdrInteractiveSessionHost(execute, {
        promptTransport: async () => {
          promptAttempts += 1;
          return { ok: true };
        },
      }).launch(input),
    ).resolves.toEqual({ ok: true, host: "herdr", status: "started" });

    expect(commands.filter((args) => args[0] === "agent" && args[1] === "start")).toHaveLength(0);
    expect(promptAttempts).toBe(1);
  });

  it.each([
    ["working", "launch_failed"],
    ["unknown", "launch_indeterminate"],
  ] as const)("does not reuse a pre-start done session while another agent is %s in the worktree", async (peerStatus, expectedCode) => {
    const commands: string[][] = [];
    let observations = 0;
    let promptAttempts = 0;
    const execute: HerdrCommandExecutor = async (args) => {
      commands.push([...args]);
      if (args[0] === "agent" && args[1] === "list") {
        observations += 1;
        return observations === 1
          ? emptyAgents()
          : listedAgents([
              matchingAgent("done"),
              {
                name: "other-session",
                workspace_id: "workspace-1",
                pane_id: "pane-2",
                agent_status: peerStatus,
              },
            ]);
      }
      if (args[0] === "workspace" && args[1] === "list") return emptyWorkspaces();
      if (args[0] === "workspace" && args[1] === "create") return createdWorkspace();
      return { ok: false, message: `unexpected Herdr command: ${args.join(" ")}` };
    };

    await expect(
      openHerdrInteractiveSessionHost(execute, {
        promptTransport: async () => {
          promptAttempts += 1;
          return { ok: true };
        },
      }).launch(input),
    ).resolves.toMatchObject({ ok: false, code: expectedCode });

    expect(commands.filter((args) => args[0] === "agent" && args[1] === "start")).toHaveLength(0);
    expect(promptAttempts).toBe(0);
  });

  it("prompts a matching done session observed after an uncertain native start", async () => {
    const commands: string[][] = [];
    let observations = 0;
    let promptAttempts = 0;
    const execute: HerdrCommandExecutor = async (args) => {
      commands.push([...args]);
      if (args[0] === "agent" && args[1] === "list") {
        observations += 1;
        return observations < 3 ? emptyAgents() : listedAgents([matchingAgent("done")]);
      }
      if (args[0] === "workspace" && args[1] === "list") return emptyWorkspaces();
      if (args[0] === "workspace" && args[1] === "create") return createdWorkspace();
      if (args[0] === "agent" && args[1] === "start") {
        return { ok: false, message: "response lost" };
      }
      return { ok: false, message: `unexpected Herdr command: ${args.join(" ")}` };
    };

    await expect(
      openHerdrInteractiveSessionHost(execute, {
        promptTransport: async () => {
          promptAttempts += 1;
          return { ok: true };
        },
      }).launch(input),
    ).resolves.toEqual({ ok: true, host: "herdr", status: "started" });

    expect(commands.filter((args) => args[0] === "agent" && args[1] === "start")).toHaveLength(1);
    expect(promptAttempts).toBe(1);
  });

  it.each([
    ["working", "launch_failed"],
    ["unknown", "launch_indeterminate"],
  ] as const)("does not prompt an initial done session while another agent is %s in the worktree", async (peerStatus, expectedCode) => {
    let promptAttempts = 0;
    const execute: HerdrCommandExecutor = async () =>
      listedAgents([
        matchingAgent("done"),
        {
          name: "other-session",
          cwd: input.worktreePath,
          pane_id: "pane-2",
          agent_status: peerStatus,
        },
      ]);

    await expect(
      openHerdrInteractiveSessionHost(execute, {
        promptTransport: async () => {
          promptAttempts += 1;
          return { ok: true };
        },
      }).launch(input),
    ).resolves.toMatchObject({ ok: false, code: expectedCode });

    expect(promptAttempts).toBe(0);
  });

  it("does not prompt a done session found after an uncertain start when another agent is active", async () => {
    let observations = 0;
    let promptAttempts = 0;
    const execute: HerdrCommandExecutor = async (args) => {
      if (args[0] === "agent" && args[1] === "list") {
        observations += 1;
        return observations < 3
          ? emptyAgents()
          : listedAgents([
              matchingAgent("done"),
              {
                name: "other-session",
                cwd: input.worktreePath,
                pane_id: "pane-2",
                agent_status: "working",
              },
            ]);
      }
      if (args[0] === "workspace" && args[1] === "list") return emptyWorkspaces();
      if (args[0] === "workspace" && args[1] === "create") return createdWorkspace();
      if (args[0] === "agent" && args[1] === "start") {
        return { ok: false, message: "response lost" };
      }
      return { ok: false, message: `unexpected Herdr command: ${args.join(" ")}` };
    };

    await expect(
      openHerdrInteractiveSessionHost(execute, {
        promptTransport: async () => {
          promptAttempts += 1;
          return { ok: true };
        },
      }).launch(input),
    ).resolves.toMatchObject({ ok: false, code: "launch_failed" });

    expect(promptAttempts).toBe(0);
  });

  it("does not prompt a done session found after an uncertain start when another agent state is unknown", async () => {
    let observations = 0;
    let promptAttempts = 0;
    const execute: HerdrCommandExecutor = async (args) => {
      if (args[0] === "agent" && args[1] === "list") {
        observations += 1;
        return observations < 3
          ? emptyAgents()
          : listedAgents([
              matchingAgent("done"),
              {
                name: "other-session",
                cwd: input.worktreePath,
                pane_id: "pane-2",
                agent_status: "unknown",
              },
            ]);
      }
      if (args[0] === "workspace" && args[1] === "list") return emptyWorkspaces();
      if (args[0] === "workspace" && args[1] === "create") return createdWorkspace();
      if (args[0] === "agent" && args[1] === "start") {
        return { ok: false, message: "response lost" };
      }
      return { ok: false, message: `unexpected Herdr command: ${args.join(" ")}` };
    };

    await expect(
      openHerdrInteractiveSessionHost(execute, {
        promptTransport: async () => {
          promptAttempts += 1;
          return { ok: true };
        },
      }).launch(input),
    ).resolves.toMatchObject({ ok: false, code: "launch_indeterminate" });

    expect(promptAttempts).toBe(0);
  });

  it("does not start or prompt another agent when the named session is active", async () => {
    const commands: readonly string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      (commands as string[][]).push([...args]);
      return {
        ok: true,
        stdout: `{"result":{"type":"agent_list","agents":[{"name":"${input.hostSessionName}","cwd":"${input.worktreePath}","workspace_id":"workspace-1","pane_id":"pane-1","agent_status":"working","future_field":true}]}}`,
      };
    };

    await expect(openHerdrInteractiveSessionHost(execute).launch(input)).resolves.toEqual({
      ok: true,
      host: "herdr",
      status: "already_active",
    });
    expect(commands).toEqual([["agent", "list"]]);
  });

  it.each([
    ["another cwd", '"cwd":"/workspace/other",'],
    ["no reported cwd", ""],
  ])("does not accept a same-name session with %s", async (_description, cwdField) => {
    const commands: string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      commands.push([...args]);
      return {
        ok: true,
        stdout: `{"result":{"type":"agent_list","agents":[{"name":"${input.hostSessionName}",${cwdField}"workspace_id":"workspace-other","pane_id":"pane-1","agent_status":"working"}]}}`,
      };
    };

    await expect(openHerdrInteractiveSessionHost(execute).launch(input)).resolves.toMatchObject({
      ok: false,
      code: "launch_indeterminate",
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
      if (args[0] === "workspace" && args[1] === "list") return emptyWorkspaces();
      if (args[0] === "workspace" && args[1] === "create") return createdWorkspace();
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
      if (args[0] === "workspace" && args[1] === "list") return emptyWorkspaces();
      if (args[0] === "workspace" && args[1] === "create") return createdWorkspace();
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
    let promptAttempts = 0;
    const execute: HerdrCommandExecutor = async (args) => {
      commands.push([...args]);
      if (args[0] === "agent" && args[1] === "list") return emptyAgents();
      if (args[0] === "workspace" && args[1] === "list") return emptyWorkspaces();
      if (args[0] === "workspace" && args[1] === "create") return createdWorkspace();
      if (args[0] === "agent" && args[1] === "start") {
        return {
          ok: true,
          stdout: '{"result":{"type":"agent_started","agent":{"terminal_id":"t-1"}}}',
        };
      }
      return { ok: false, message: "unexpected prompt retry" };
    };

    await expect(
      openHerdrInteractiveSessionHost(execute, {
        promptTransport: async () => {
          promptAttempts += 1;
          return { ok: false, transmission: "unknown", message: "response lost" };
        },
      }).launch(input),
    ).resolves.toMatchObject({
      ok: false,
      code: "launch_indeterminate",
    });
    expect(promptAttempts).toBe(1);
    expect(commands.some((args) => args[0] === "agent" && args[1] === "prompt")).toBe(false);
    expect(commands.at(-1)).toEqual(["agent", "list"]);
  });
});
