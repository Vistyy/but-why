import { describe, expect, it } from "vitest";

import {
  herdrSessionName,
  openHerdrInteractiveSessionHost,
  type HerdrCommandExecutor,
} from "../../src/change/herdrInteractiveSessionHost.js";

const unavailableHerdr: HerdrCommandExecutor = async () => ({
  ok: false,
  message: "connect ECONNREFUSED",
});

const workspaceFailure: HerdrCommandExecutor = async (args) =>
  args[0] === "agent"
    ? { ok: true, stdout: '{"result":{"type":"agent_list","agents":[]}}' }
    : { ok: false, message: "workspace unavailable" };

describe("Herdr Interactive Session Host", () => {
  it("opens an existing Managed Worktree and starts a named Pi session", async () => {
    const commands: readonly string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      (commands as string[][]).push([...args]);
      if (args[0] === "agent" && args[1] === "list") {
        return commands.some(([command, operation]) => command === "pane" && operation === "run")
          ? {
              ok: true,
              stdout:
                '{"result":{"type":"agent_list","agents":[{"name":"but-why-change-123","cwd":"/workspace/change-123","pane_id":"workspace-1:pane-1","agent_status":"working"}]}}',
            }
          : { ok: true, stdout: '{"result":{"type":"agent_list","agents":[]}}' };
      }
      if (args[0] === "worktree") {
        return {
          ok: true,
          stdout:
            '{"result":{"type":"worktree_open","workspace":{"workspace_id":"workspace-1"},"root_pane":{"pane_id":"workspace-1:pane-1"},"already_open":false}}',
        };
      }
      if (args[0] === "agent" && args[1] === "rename") {
        return {
          ok: true,
          stdout:
            '{"result":{"agent":{"name":"but-why-change-123","pane_id":"workspace-1:pane-1","cwd":"/workspace/change-123"}}}',
        };
      }
      return { ok: true, stdout: "{}" };
    };
    const sessionName = herdrSessionName("change-123");

    const result = await openHerdrInteractiveSessionHost(execute, {
      path: "/usr/local/bin:/opt/pi/bin",
    }).launch({
      changeId: "change-123",
      repositoryPath: "/repository",
      worktreePath: "/workspace/change-123",
      initialPrompt: "---\ndescription: Continue from the recorded decision.\n---",
      agentProfile: {
        agentProfile: "implementation",
        scope: "global",
        profile: {
          agentRuntime: "pi",
          runtimeConfig: { model: "openai-codex/gpt-5.6-luna", thinking: "high" },
        },
      },
      globalConfigDirectory: "/home/test/.config/but-why",
      agentEnvironment: ["nix", "develop", "-c"],
    });

    expect(result).toEqual({ ok: true, host: "herdr", status: "started" });
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
        sessionName,
        "--no-focus",
      ],
      ["agent", "list"],
      [
        "pane",
        "run",
        "workspace-1:pane-1",
        "PATH='/usr/local/bin:/opt/pi/bin' exec 'nix' 'develop' '-c' pi --name 'but-why-change-123' --model 'openai-codex/gpt-5.6-luna' --thinking 'high' '\n---\ndescription: Continue from the recorded decision.\n---'",
      ],
      ["agent", "rename", "workspace-1:pane-1", sessionName],
      ["agent", "list"],
    ]);
  });

  it("materializes scoped Pi resource allowlists for the Implementer", async () => {
    const commands: readonly string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      (commands as string[][]).push([...args]);
      if (args[0] === "agent" && args[1] === "list") {
        return commands.some(([command, operation]) => command === "pane" && operation === "run")
          ? {
              ok: true,
              stdout:
                '{"result":{"type":"agent_list","agents":[{"name":"but-why-change-123","cwd":"/workspace/change-123","pane_id":"workspace-1:pane-1","agent_status":"working"}]}}',
            }
          : { ok: true, stdout: '{"result":{"type":"agent_list","agents":[]}}' };
      }
      if (args[0] === "worktree") {
        return {
          ok: true,
          stdout:
            '{"result":{"type":"worktree_open","workspace":{"workspace_id":"workspace-1"},"root_pane":{"pane_id":"workspace-1:pane-1"},"already_open":false}}',
        };
      }
      if (args[0] === "agent" && args[1] === "rename") {
        return {
          ok: true,
          stdout:
            '{"result":{"agent":{"name":"but-why-change-123","pane_id":"workspace-1:pane-1","cwd":"/workspace/change-123"}}}',
        };
      }
      return { ok: true, stdout: "{}" };
    };

    await expect(
      openHerdrInteractiveSessionHost(execute).launch({
        changeId: "change-123",
        repositoryPath: "/repository",
        worktreePath: "/workspace/change-123",
        initialPrompt: "Implement",
        agentProfile: {
          agentProfile: "implementation",
          scope: "repo",
          profile: {
            agentRuntime: "pi",
            runtimeConfig: {
              extensions: ["extensions/one.ts"],
              skills: ["skills/one"],
              tools: [],
              contextFileDiscovery: false,
            },
          },
        },
        globalConfigDirectory: "/global/config",
      }),
    ).resolves.toEqual({ ok: true, host: "herdr", status: "started" });

    expect(commands[3]?.[3]).toContain(
      "--no-extensions --extension '/workspace/change-123/extensions/one.ts'",
    );
    expect(commands[3]?.[3]).toContain("--no-skills --skill '/workspace/change-123/skills/one'");
    expect(commands[3]?.[3]).toContain("--tools '' --no-context-files");
  });

  it("returns a retryable failure when a concurrent launch claims the session name", async () => {
    const commands: string[][] = [];
    const sessionName = herdrSessionName("change-123");
    const execute: HerdrCommandExecutor = async (args) => {
      commands.push([...args]);
      if (
        args[0] === "agent" &&
        args[1] === "list" &&
        commands.filter(([command, operation]) => command === "agent" && operation === "list")
          .length <= 2
      ) {
        return { ok: true, stdout: '{"result":{"type":"agent_list","agents":[]}}' };
      }
      if (args[0] === "worktree") {
        return {
          ok: true,
          stdout:
            '{"result":{"type":"worktree_open","workspace":{"workspace_id":"workspace-1"},"root_pane":{"pane_id":"workspace-1:pane-1"},"already_open":false}}',
        };
      }
      if (args[0] === "agent" && args[1] === "rename") {
        return { ok: false, message: "agent_name_taken" };
      }
      if (args[0] === "agent" && args[1] === "list") {
        return {
          ok: true,
          stdout: `{"result":{"type":"agent_list","agents":[{"agent":"${sessionName}","cwd":"/workspace/change-123","pane_id":"other-pane","agent_status":"working"}]}}`,
        };
      }
      return { ok: true, stdout: "{}" };
    };

    await expect(
      openHerdrInteractiveSessionHost(execute).launch({
        changeId: "change-123",
        repositoryPath: "/repository",
        worktreePath: "/workspace/change-123",
        initialPrompt: undefined,
      }),
    ).resolves.toMatchObject({ ok: false, code: "launch_failed" });
    expect(commands).toContainEqual(["workspace", "close", "workspace-1"]);
  });

  it("reuses an idle Herdr workspace after a done Interactive Session", async () => {
    const commands: string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      commands.push([...args]);
      if (args[0] === "agent" && args[1] === "list") {
        return {
          ok: true,
          stdout:
            commands.filter(([command, operation]) => command === "agent" && operation === "list")
              .length === 1
              ? `{"result":{"type":"agent_list","agents":[{"agent":"${herdrSessionName("change-123")}","cwd":"/workspace/change-123","pane_id":"workspace-1:pane-1","agent_status":"done"}]}}`
              : `{"result":{"type":"agent_list","agents":[{"agent":"${herdrSessionName("change-123")}","cwd":"/workspace/change-123","pane_id":"workspace-1:pane-1","agent_status":"working"}]}}`,
        };
      }
      if (args[0] === "worktree") {
        return {
          ok: true,
          stdout:
            '{"result":{"type":"worktree_open","workspace":{"workspace_id":"workspace-1"},"root_pane":{"pane_id":"workspace-1:pane-1"},"already_open":true}}',
        };
      }
      if (args[0] === "agent" && args[1] === "rename") {
        return {
          ok: true,
          stdout:
            '{"result":{"agent":{"name":"but-why-change-123","pane_id":"workspace-1:pane-1","cwd":"/workspace/change-123"}}}',
        };
      }
      return { ok: true, stdout: "{}" };
    };

    await expect(
      openHerdrInteractiveSessionHost(execute).launch({
        changeId: "change-123",
        repositoryPath: "/repository",
        worktreePath: "/workspace/change-123",
        initialPrompt: undefined,
      }),
    ).resolves.toEqual({ ok: true, host: "herdr", status: "started" });
    expect(commands).toContainEqual([
      "worktree",
      "open",
      "--cwd",
      "/repository",
      "--path",
      "/workspace/change-123",
      "--label",
      herdrSessionName("change-123"),
      "--no-focus",
    ]);
  });

  it("interrupts Pi after a rename failure in an existing workspace", async () => {
    const commands: string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      commands.push([...args]);
      if (args[0] === "agent" && args[1] === "list") {
        return { ok: true, stdout: '{"result":{"type":"agent_list","agents":[]}}' };
      }
      if (args[0] === "worktree") {
        return {
          ok: true,
          stdout:
            '{"result":{"type":"worktree_open","workspace":{"workspace_id":"workspace-1"},"root_pane":{"pane_id":"workspace-1:pane-1"},"already_open":true}}',
        };
      }
      if (args[0] === "agent" && args[1] === "rename") {
        return { ok: false, message: "agent_name_taken" };
      }
      return { ok: true, stdout: "{}" };
    };

    await expect(
      openHerdrInteractiveSessionHost(execute).launch({
        changeId: "change-123",
        repositoryPath: "/repository",
        worktreePath: "/workspace/change-123",
        initialPrompt: undefined,
      }),
    ).resolves.toMatchObject({ ok: false, code: "launch_failed" });
    expect(commands).toContainEqual(["pane", "send-keys", "workspace-1:pane-1", "ctrl-c"]);
    expect(commands).not.toContainEqual(["workspace", "close", "workspace-1"]);
  });

  it("removes its workspace after a pane-run failure so a retry can start", async () => {
    let paneRuns = 0;
    const commands: string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      commands.push([...args]);
      if (args[0] === "agent" && args[1] === "list") {
        return paneRuns < 2
          ? { ok: true, stdout: '{"result":{"type":"agent_list","agents":[]}}' }
          : {
              ok: true,
              stdout:
                '{"result":{"type":"agent_list","agents":[{"name":"but-why-change-123","cwd":"/workspace/change-123","pane_id":"workspace-1:pane-1","agent_status":"working"}]}}',
            };
      }
      if (args[0] === "worktree") {
        return {
          ok: true,
          stdout:
            '{"result":{"type":"worktree_open","workspace":{"workspace_id":"workspace-1"},"root_pane":{"pane_id":"workspace-1:pane-1"},"already_open":false}}',
        };
      }
      if (args[0] === "pane" && args[1] === "run") {
        paneRuns += 1;
        return paneRuns === 1
          ? { ok: false, message: "pane unavailable" }
          : { ok: true, stdout: "{}" };
      }
      if (args[0] === "agent" && args[1] === "rename") {
        return {
          ok: true,
          stdout:
            '{"result":{"agent":{"name":"but-why-change-123","pane_id":"workspace-1:pane-1","cwd":"/workspace/change-123"}}}',
        };
      }
      return { ok: true, stdout: "{}" };
    };
    const host = openHerdrInteractiveSessionHost(execute);
    const input = {
      changeId: "change-123",
      repositoryPath: "/repository",
      worktreePath: "/workspace/change-123",
      initialPrompt: undefined,
    } as const;

    await expect(host.launch(input)).resolves.toMatchObject({ ok: false, code: "launch_failed" });
    await expect(host.launch(input)).resolves.toEqual({
      ok: true,
      host: "herdr",
      status: "started",
    });
    expect(commands).toContainEqual(["workspace", "close", "workspace-1"]);
  });

  it("returns already active without creating another workspace", async () => {
    const execute: HerdrCommandExecutor = async () => ({
      ok: true,
      stdout: `{"id":"cli:agent:list","result":{"agents":[{"agent":"${herdrSessionName("change-123")}","cwd":"/workspace/change-123","pane_id":"workspace-1:pane-1","agent_status":"working"}],"type":"agent_list"}}`,
    });

    await expect(
      openHerdrInteractiveSessionHost(execute).launch({
        changeId: "change-123",
        repositoryPath: "/repository",
        worktreePath: "/workspace/change-123",
        initialPrompt: undefined,
      }),
    ).resolves.toEqual({ ok: true, host: "herdr", status: "already_active" });
  });

  it("reconciles an uncertain worktree open before retrying the mutation", async () => {
    const commands: string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      commands.push([...args]);
      if (args[0] === "agent" && args[1] === "list") {
        return commands.some(([command, operation]) => command === "pane" && operation === "run")
          ? {
              ok: true,
              stdout:
                '{"result":{"type":"agent_list","agents":[{"name":"but-why-change-123","cwd":"/workspace/change-123","pane_id":"workspace-1:pane-1","agent_status":"working"}]}}',
            }
          : { ok: true, stdout: '{"result":{"type":"agent_list","agents":[]}}' };
      }
      if (args[0] === "worktree" && args[1] === "open") {
        const opens = commands.filter(
          ([command, operation]) => command === "worktree" && operation === "open",
        ).length;
        return opens === 1
          ? { ok: false, message: "response lost" }
          : {
              ok: true,
              stdout:
                '{"result":{"type":"worktree_open","workspace":{"workspace_id":"workspace-1"},"root_pane":{"pane_id":"workspace-1:pane-1"},"already_open":false}}',
            };
      }
      if (args[0] === "worktree" && args[1] === "list") {
        return {
          ok: true,
          stdout:
            '{"result":{"type":"worktree_list","worktrees":[{"path":"/workspace/change-123","branch":"but-why/change-123","repository_path":"/repository"}]}}',
        };
      }
      if (args[0] === "agent" && args[1] === "rename") {
        return {
          ok: true,
          stdout:
            '{"result":{"agent":{"name":"but-why-change-123","pane_id":"workspace-1:pane-1","cwd":"/workspace/change-123"}}}',
        };
      }
      if (args[0] === "pane" && args[1] === "run") return { ok: true, stdout: "{}" };
      return { ok: true, stdout: "{}" };
    };

    await expect(
      openHerdrInteractiveSessionHost(execute).launch({
        changeId: "change-123",
        repositoryPath: "/repository",
        worktreePath: "/workspace/change-123",
        initialPrompt: undefined,
      }),
    ).resolves.toEqual({ ok: true, host: "herdr", status: "started" });
    expect(
      commands.filter(([command, operation]) => command === "worktree" && operation === "open"),
    ).toHaveLength(2);
  });

  it("returns indeterminate after an uncertain worktree retry remains unresolved", async () => {
    const commands: string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      commands.push([...args]);
      if (args[0] === "agent" && args[1] === "list") {
        return { ok: true, stdout: '{"result":{"type":"agent_list","agents":[]}}' };
      }
      if (args[0] === "worktree" && args[1] === "open") {
        return { ok: false, message: "response lost" };
      }
      if (args[0] === "worktree" && args[1] === "list") {
        return {
          ok: true,
          stdout:
            '{"result":{"type":"worktree_list","worktrees":[{"path":"/workspace/change-123","branch":"but-why/change-123","repository_path":"/repository"}]}}',
        };
      }
      return { ok: true, stdout: "{}" };
    };

    await expect(
      openHerdrInteractiveSessionHost(execute).launch({
        changeId: "change-123",
        repositoryPath: "/repository",
        worktreePath: "/workspace/change-123",
        initialPrompt: undefined,
      }),
    ).resolves.toMatchObject({ ok: false, code: "launch_indeterminate" });
    expect(
      commands.filter(([command, operation]) => command === "worktree" && operation === "open"),
    ).toHaveLength(2);
  });

  it("reconciles a lost rename response before retrying", async () => {
    let renameAttempts = 0;
    const commands: string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      commands.push([...args]);
      if (args[0] === "agent" && args[1] === "list") {
        return renameAttempts > 1
          ? {
              ok: true,
              stdout:
                '{"result":{"type":"agent_list","agents":[{"name":"but-why-change-123","cwd":"/workspace/change-123","pane_id":"workspace-1:pane-1","agent_status":"working"}]}}',
            }
          : { ok: true, stdout: '{"result":{"type":"agent_list","agents":[]}}' };
      }
      if (args[0] === "worktree") {
        return {
          ok: true,
          stdout:
            '{"result":{"type":"worktree_open","workspace":{"workspace_id":"workspace-1"},"root_pane":{"pane_id":"workspace-1:pane-1"},"already_open":false}}',
        };
      }
      if (args[0] === "pane" && args[1] === "run") return { ok: true, stdout: "{}" };
      if (args[0] === "agent" && args[1] === "rename") {
        renameAttempts += 1;
        return renameAttempts === 1
          ? { ok: false, message: "lost response" }
          : {
              ok: true,
              stdout:
                '{"result":{"agent":{"name":"but-why-change-123","cwd":"/workspace/change-123","pane_id":"workspace-1:pane-1"}}}',
            };
      }
      return { ok: true, stdout: "{}" };
    };

    await expect(
      openHerdrInteractiveSessionHost(execute).launch({
        changeId: "change-123",
        repositoryPath: "/repository",
        worktreePath: "/workspace/change-123",
        initialPrompt: undefined,
      }),
    ).resolves.toEqual({ ok: true, host: "herdr", status: "started" });
    expect(renameAttempts).toBe(2);
  });

  it("preserves evidence when Pi exits before rename", async () => {
    const execute: HerdrCommandExecutor = async (args) => {
      if (args[0] === "agent" && args[1] === "list") {
        return { ok: true, stdout: '{"result":{"type":"agent_list","agents":[]}}' };
      }
      if (args[0] === "worktree") {
        return {
          ok: true,
          stdout:
            '{"result":{"type":"worktree_open","workspace":{"workspace_id":"workspace-1"},"root_pane":{"pane_id":"workspace-1:pane-1"},"already_open":false}}',
        };
      }
      if (args[0] === "pane" && args[1] === "run") return { ok: true, stdout: "{}" };
      if (args[0] === "agent" && args[1] === "rename") {
        return { ok: false, message: "lost response" };
      }
      if (args[0] === "pane" && args[1] === "read") {
        return { ok: false, message: "pane no-such-pane not found" };
      }
      if (args[0] === "pane" && args[1] === "process-info") {
        return { ok: false, message: "pane_not_found" };
      }
      return { ok: true, stdout: "{}" };
    };

    await expect(
      openHerdrInteractiveSessionHost(execute).launch({
        changeId: "change-123",
        repositoryPath: "/repository",
        worktreePath: "/workspace/change-123",
        initialPrompt: undefined,
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "launch_failed",
      evidence: {
        exitEvidence: "Herdr process inspection failed: pane_not_found",
      },
    });
  });

  it("does not retry an uncertain pane run and preserves early-exit evidence", async () => {
    const commands: string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      commands.push([...args]);
      if (args[0] === "agent" && args[1] === "list") {
        return { ok: true, stdout: '{"result":{"type":"agent_list","agents":[]}}' };
      }
      if (args[0] === "worktree") {
        return {
          ok: true,
          stdout:
            '{"result":{"type":"worktree_open","workspace":{"workspace_id":"workspace-1"},"root_pane":{"pane_id":"workspace-1:pane-1"},"already_open":false}}',
        };
      }
      if (args[0] === "pane" && args[1] === "run") return new Promise(() => {});
      if (args[0] === "pane" && args[1] === "read")
        return { ok: false, message: "pane no-such-pane not found" };
      if (args[0] === "pane" && args[1] === "process-info")
        return { ok: false, message: "pane_not_found" };
      return { ok: true, stdout: "{}" };
    };

    await expect(
      openHerdrInteractiveSessionHost(execute, {
        commandTimeoutMs: 5,
        readinessTimeoutMs: 20,
        readinessPollMs: 1,
      }).launch({
        changeId: "change-123",
        repositoryPath: "/repository",
        worktreePath: "/workspace/change-123",
        initialPrompt: undefined,
      }),
    ).resolves.toEqual({
      ok: false,
      code: "launch_failed",
      message: expect.stringContaining("exited during startup"),
      evidence: {
        startupOutput: "Herdr pane read failed: pane no-such-pane not found",
        exitEvidence: "Herdr process inspection failed: pane_not_found",
      },
    });
    expect(
      commands.filter(([command, operation]) => command === "pane" && operation === "run"),
    ).toHaveLength(1);
  });

  it.each([
    ["cannot reach Herdr", unavailableHerdr, "host_unavailable"],
    ["cannot open the worktree", workspaceFailure, "launch_failed"],
  ] as const)("returns retryable failure when it %s", async (_name, execute, code) => {
    await expect(
      openHerdrInteractiveSessionHost(execute).launch({
        changeId: "change-123",
        repositoryPath: "/repository",
        worktreePath: "/workspace/change-123",
        initialPrompt: undefined,
      }),
    ).resolves.toMatchObject({ ok: false, code });
  });
});
