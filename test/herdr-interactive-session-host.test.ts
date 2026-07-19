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
      if (args[0] === "workspace") {
        return { ok: true, stdout: '{"result":{"workspace":{"workspace_id":"workspace-1"}}}' };
      }
      return { ok: true, stdout: "{}" };
    };
    const sessionName = herdrSessionName("change-123");

    const result = await openHerdrInteractiveSessionHost(execute).launch({
      changeId: "change-123",
      worktreePath: "/workspace/change-123",
      initialPrompt: "Continue from the recorded decision.",
    });

    expect(result).toEqual({ ok: true, host: "herdr", status: "started" });
    expect(commands).toEqual([
      ["agent", "list"],
      [
        "workspace",
        "create",
        "--cwd",
        "/workspace/change-123",
        "--label",
        sessionName,
        "--no-focus",
      ],
      [
        "agent",
        "start",
        sessionName,
        "--workspace",
        "workspace-1",
        "--no-focus",
        "--",
        "pi",
        "--name",
        sessionName,
        "Implement Change change-123 in this Managed Worktree.\n\nContinue from the recorded decision.",
      ],
    ]);
  });

  it("returns already active without creating another workspace", async () => {
    const execute: HerdrCommandExecutor = async () => ({
      ok: true,
      stdout: `{"result":{"agents":[{"agent":"${herdrSessionName("change-123")}"}]}}`,
    });

    await expect(
      openHerdrInteractiveSessionHost(execute).launch({
        changeId: "change-123",
        worktreePath: "/workspace/change-123",
        initialPrompt: undefined,
      }),
    ).resolves.toEqual({ ok: true, host: "herdr", status: "already_active" });
  });

  it.each([
    ["cannot reach Herdr", unavailableHerdr, "host_unavailable"],
    ["cannot create the workspace", workspaceFailure, "launch_failed"],
  ] as const)("returns retryable failure when it %s", async (_name, execute, code) => {
    await expect(
      openHerdrInteractiveSessionHost(execute).launch({
        changeId: "change-123",
        worktreePath: "/workspace/change-123",
        initialPrompt: undefined,
      }),
    ).resolves.toMatchObject({ ok: false, code });
  });
});
