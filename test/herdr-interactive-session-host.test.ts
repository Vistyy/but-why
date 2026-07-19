import { describe, expect, it } from "vitest";

import {
  herdrSessionName,
  openHerdrInteractiveSessionHost,
  type HerdrCommandExecutor,
} from "../src/change/herdrInteractiveSessionHost.js";

const unavailableHerdr: HerdrCommandExecutor = async () => ({
  ok: false,
  message: "connect ECONNREFUSED",
});

const workspaceFailure: HerdrCommandExecutor = async (args) =>
  args[0] === "agent"
    ? { ok: true, stdout: '{"result":{"agents":[]}}' }
    : { ok: false, message: "workspace unavailable" };

describe("Herdr Interactive Session Host", () => {
  it("opens an existing Managed Worktree and starts a named Pi session", async () => {
    const commands: readonly string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      (commands as string[][]).push([...args]);
      if (args[0] === "agent" && args[1] === "list") {
        return { ok: true, stdout: '{"result":{"agents":[]}}' };
      }
      if (args[0] === "worktree") {
        return {
          ok: true,
          stdout:
            '{"result":{"workspace":{"workspace_id":"workspace-1"},"root_pane":{"pane_id":"workspace-1:pane-1"},"already_open":false}}',
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
      initialPrompt: "Continue from the recorded decision.",
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
      [
        "pane",
        "run",
        "workspace-1:pane-1",
        "PATH='/usr/local/bin:/opt/pi/bin' exec pi --name 'but-why-change-123' 'Implement Change change-123 in this Managed Worktree.\n\nContinue from the recorded decision.'",
      ],
      ["agent", "rename", "workspace-1:pane-1", sessionName],
    ]);
  });

  it("returns a retryable failure when a concurrent launch claims the session name", async () => {
    const commands: string[][] = [];
    const sessionName = herdrSessionName("change-123");
    const execute: HerdrCommandExecutor = async (args) => {
      commands.push([...args]);
      if (args[0] === "agent" && args[1] === "list" && commands.length === 1) {
        return { ok: true, stdout: '{"result":{"agents":[]}}' };
      }
      if (args[0] === "worktree") {
        return {
          ok: true,
          stdout:
            '{"result":{"workspace":{"workspace_id":"workspace-1"},"root_pane":{"pane_id":"workspace-1:pane-1"},"already_open":false}}',
        };
      }
      if (args[0] === "agent" && args[1] === "rename") {
        return { ok: false, message: "agent_name_taken" };
      }
      if (args[0] === "agent" && args[1] === "list") {
        return {
          ok: true,
          stdout: `{"result":{"agents":[{"agent":"${sessionName}","cwd":"/workspace/change-123","agent_status":"working"}]}}`,
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
          stdout: `{"result":{"agents":[{"agent":"${herdrSessionName("change-123")}","cwd":"/workspace/change-123","agent_status":"done"}]}}`,
        };
      }
      if (args[0] === "worktree") {
        return {
          ok: true,
          stdout:
            '{"result":{"workspace":{"workspace_id":"workspace-1"},"root_pane":{"pane_id":"workspace-1:pane-1"},"already_open":true}}',
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
        return { ok: true, stdout: '{"result":{"agents":[]}}' };
      }
      if (args[0] === "worktree") {
        return {
          ok: true,
          stdout:
            '{"result":{"workspace":{"workspace_id":"workspace-1"},"root_pane":{"pane_id":"workspace-1:pane-1"},"already_open":true}}',
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
        return { ok: true, stdout: '{"result":{"agents":[]}}' };
      }
      if (args[0] === "worktree") {
        return {
          ok: true,
          stdout:
            '{"result":{"workspace":{"workspace_id":"workspace-1"},"root_pane":{"pane_id":"workspace-1:pane-1"},"already_open":false}}',
        };
      }
      if (args[0] === "pane") {
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
      stdout: `{"id":"cli:agent:list","result":{"agents":[{"agent":"${herdrSessionName("change-123")}","cwd":"/workspace/change-123","agent_status":"working"}],"type":"agent_list"}}`,
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
