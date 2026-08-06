import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  flushHerdrLaunchArtifactsForTesting,
  openHerdrInteractiveSessionHost,
  pendingHerdrLaunchArtifactsForTesting,
  type HerdrCommandExecutor,
} from "../../src/change/interactiveSession/herdrInteractiveSessionHost.js";

const readPiLaunchScriptPath = (command: string | undefined): string | undefined => {
  const match = /^exec '([^']+)'$/.exec(command ?? "");
  return match?.[1];
};

const captureLaunchScripts = (): {
  paths: string[];
  dirs: string[];
  track: (path: string | undefined) => void;
  cleanup: () => void;
} => {
  const paths: string[] = [];
  const dirs: string[] = [];
  return {
    paths,
    dirs,
    track: (path) => {
      if (path === undefined) return;
      paths.push(path);
      dirs.push(dirname(path));
    },
    cleanup: () => {
      for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
      paths.length = 0;
      dirs.length = 0;
    },
  };
};

describe("Herdr Interactive Session Host artifact lifecycle", () => {
  beforeEach(async () => {
    await flushHerdrLaunchArtifactsForTesting();
  });

  afterEach(async () => {
    await flushHerdrLaunchArtifactsForTesting();
  });

  it("removes the launch script after a successful start and preserves the structured result", async () => {
    const capture = captureLaunchScripts();
    let launchScriptContent = "";
    const execute: HerdrCommandExecutor = async (args) => {
      if (args[0] === "pane" && args[1] === "run") {
        const scriptPath = readPiLaunchScriptPath(args[3]);
        capture.track(scriptPath);
        if (scriptPath !== undefined && existsSync(scriptPath)) {
          launchScriptContent = readFileSync(scriptPath, "utf8");
        }
      }
      if (args[0] === "agent" && args[1] === "list") {
        return capture.paths.length > 0
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
            '{"result":{"type":"worktree_opened","workspace":{"workspace_id":"workspace-1"},"root_pane":{"pane_id":"workspace-1:pane-1"},"already_open":false}}',
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

    const result = await openHerdrInteractiveSessionHost(execute).launch({
      changeId: "change-123",
      repositoryPath: "/repository",
      worktreePath: "/workspace/change-123",
      initialPrompt: "Implement",
    });

    expect(result).toEqual({ ok: true, host: "herdr", status: "started" });
    // Launch script was created and contained the Pi command
    expect(launchScriptContent).toContain("exec pi");
    // Artifact is owned through use and then released: pane run saw the file, host removed it
    expect(capture.paths).toHaveLength(1);
    expect(existsSync(capture.paths[0]!)).toBe(false);
    expect(pendingHerdrLaunchArtifactsForTesting()).toBe(0);
    capture.cleanup();
  });

  it("removes the launch script after a deterministic pane failure without hiding the failure", async () => {
    const capture = captureLaunchScripts();
    const execute: HerdrCommandExecutor = async (args) => {
      if (args[0] === "pane" && args[1] === "run") {
        capture.track(readPiLaunchScriptPath(args[3]));
      }
      if (args[0] === "agent" && args[1] === "list") {
        return { ok: true, stdout: '{"result":{"type":"agent_list","agents":[]}}' };
      }
      if (args[0] === "worktree") {
        return {
          ok: true,
          stdout:
            '{"result":{"type":"worktree_opened","workspace":{"workspace_id":"workspace-1"},"root_pane":{"pane_id":"workspace-1:pane-1"},"already_open":false}}',
        };
      }
      if (args[0] === "pane" && args[1] === "run") return { ok: false, message: "pane unavailable" } as never;
      return { ok: true, stdout: "{}" };
    };
    // Override to ensure deterministic failure path
    let paneRuns = 0;
    const failingExecute: HerdrCommandExecutor = async (args) => {
      if (args[0] === "pane" && args[1] === "run") {
        paneRuns += 1;
        capture.track(readPiLaunchScriptPath(args[3]));
        return { ok: false, message: "pane unavailable" };
      }
      if (args[0] === "agent" && args[1] === "list") {
        return { ok: true, stdout: '{"result":{"type":"agent_list","agents":[]}}' };
      }
      if (args[0] === "worktree") {
        return {
          ok: true,
          stdout:
            '{"result":{"type":"worktree_opened","workspace":{"workspace_id":"workspace-1"},"root_pane":{"pane_id":"workspace-1:pane-1"},"already_open":false}}',
        };
      }
      if (args[0] === "workspace" && args[1] === "close") return { ok: true, stdout: "{}" };
      if (args[0] === "pane" && args[1] === "read") return { ok: true, stdout: "" };
      if (args[0] === "pane" && args[1] === "process-info") return { ok: true, stdout: "" };
      return { ok: true, stdout: "{}" };
    };

    const result = await openHerdrInteractiveSessionHost(failingExecute).launch({
      changeId: "change-123",
      repositoryPath: "/repository",
      worktreePath: "/workspace/change-123",
      initialPrompt: undefined,
    });

    expect(result).toMatchObject({ ok: false, code: "launch_failed" });
    expect(capture.paths).toHaveLength(1);
    expect(existsSync(capture.paths[0]!)).toBe(false);
    expect(pendingHerdrLaunchArtifactsForTesting()).toBe(0);
    capture.cleanup();
  });

  it("removes the launch script after a readiness failure and keeps diagnostic evidence", async () => {
    const capture = captureLaunchScripts();
    const execute: HerdrCommandExecutor = async (args) => {
      if (args[0] === "pane" && args[1] === "run") {
        capture.track(readPiLaunchScriptPath(args[3]));
        return { ok: true, stdout: "{}" };
      }
      if (args[0] === "agent" && args[1] === "list") {
        return { ok: true, stdout: '{"result":{"type":"agent_list","agents":[]}}' };
      }
      if (args[0] === "worktree") {
        return {
          ok: true,
          stdout:
            '{"result":{"type":"worktree_opened","workspace":{"workspace_id":"workspace-1"},"root_pane":{"pane_id":"workspace-1:pane-1"},"already_open":false}}',
        };
      }
      if (args[0] === "pane" && args[1] === "read") {
        return { ok: true, stdout: "Starting Pi" };
      }
      if (args[0] === "pane" && args[1] === "process-info") {
        return { ok: true, stdout: '{"result":{"processes":[{"name":"pi"}]}}' };
      }
      return { ok: true, stdout: "{}" };
    };

    const result = await openHerdrInteractiveSessionHost(execute, {
      readinessTimeoutMs: 5,
      readinessPollMs: 1,
    }).launch({
      changeId: "change-123",
      repositoryPath: "/repository",
      worktreePath: "/workspace/change-123",
      initialPrompt: undefined,
    });

    expect(result).toMatchObject({ ok: false, code: "launch_indeterminate" });
    expect((result as { ok: false; evidence?: { startupOutput?: string } }).evidence?.startupOutput).toBe("Starting Pi");
    // Temporary launch artifact is gone, diagnostic evidence remains
    expect(capture.paths).toHaveLength(1);
    expect(existsSync(capture.paths[0]!)).toBe(false);
    expect(pendingHerdrLaunchArtifactsForTesting()).toBe(0);
    capture.cleanup();
  });

  it("retains the launch script while a late uncertain pane run can still consume it, then releases via explicit route", async () => {
    const capture = captureLaunchScripts();
    const execute: HerdrCommandExecutor = async (args) => {
      if (args[0] === "pane" && args[1] === "run") {
        capture.track(readPiLaunchScriptPath(args[3]));
        return { ok: false, message: "response lost" };
      }
      if (args[0] === "agent" && args[1] === "list") {
        return { ok: true, stdout: '{"result":{"type":"agent_list","agents":[]}}' };
      }
      if (args[0] === "worktree") {
        return {
          ok: true,
          stdout:
            '{"result":{"type":"worktree_opened","workspace":{"workspace_id":"workspace-1"},"root_pane":{"pane_id":"workspace-1:pane-1"},"already_open":true}}',
        };
      }
      if (args[0] === "pane" && args[1] === "read") return { ok: true, stdout: "" };
      if (args[0] === "pane" && args[1] === "process-info") return { ok: true, stdout: "" };
      return { ok: true, stdout: "{}" };
    };

    const host = openHerdrInteractiveSessionHost(execute, {
      readinessTimeoutMs: 5,
      readinessPollMs: 1,
    });

    const result = await host.launch({
      changeId: "change-123",
      repositoryPath: "/repository",
      worktreePath: "/workspace/change-123",
      initialPrompt: undefined,
    });

    expect(result).toMatchObject({ ok: false, code: "launch_indeterminate" });
    // Artifact remains owned while late Herdr command can still consume it
    expect(capture.paths).toHaveLength(1);
    expect(existsSync(capture.paths[0]!)).toBe(true);
    expect(pendingHerdrLaunchArtifactsForTesting()).toBe(1);

    // Explicit later cleanup route releases it without accumulating
    await flushHerdrLaunchArtifactsForTesting();
    expect(existsSync(capture.paths[0]!)).toBe(false);
    expect(pendingHerdrLaunchArtifactsForTesting()).toBe(0);
    capture.cleanup();
  });

  it("cleans the uncertain artifact after workspace close when late execution can no longer consume it", async () => {
    const capture = captureLaunchScripts();
    const closedWorkspaces: string[][] = [];
    const execute: HerdrCommandExecutor = async (args) => {
      if (args[0] === "pane" && args[1] === "run") {
        capture.track(readPiLaunchScriptPath(args[3]));
        return { ok: false, message: "timed out" };
      }
      if (args[0] === "agent" && args[1] === "list") {
        return { ok: true, stdout: '{"result":{"type":"agent_list","agents":[]}}' };
      }
      if (args[0] === "worktree") {
        return {
          ok: true,
          stdout:
            '{"result":{"type":"worktree_opened","workspace":{"workspace_id":"workspace-1"},"root_pane":{"pane_id":"workspace-1:pane-1"},"already_open":false}}',
        };
      }
      if (args[0] === "workspace" && args[1] === "close") {
        closedWorkspaces.push([...args]);
        return { ok: true, stdout: "{}" };
      }
      if (args[0] === "pane" && args[1] === "read") return { ok: true, stdout: "" };
      if (args[0] === "pane" && args[1] === "process-info") return { ok: true, stdout: "" };
      return { ok: true, stdout: "{}" };
    };

    const result = await openHerdrInteractiveSessionHost(execute, {
      readinessTimeoutMs: 5,
      readinessPollMs: 1,
    }).launch({
      changeId: "change-123",
      repositoryPath: "/repository",
      worktreePath: "/workspace/change-123",
      initialPrompt: undefined,
    });

    expect(result).toMatchObject({ ok: false });
    expect(closedWorkspaces).toContainEqual(["workspace", "close", "workspace-1"]);
    // After workspace close, artifact is released
    expect(capture.paths).toHaveLength(1);
    expect(existsSync(capture.paths[0]!)).toBe(false);
    expect(pendingHerdrLaunchArtifactsForTesting()).toBe(0);
    capture.cleanup();
  });

  it("does not accumulate obsolete artifacts across repeated uncertain attempts", async () => {
    const capture = captureLaunchScripts();
    let attempt = 0;
    const execute: HerdrCommandExecutor = async (args) => {
      if (args[0] === "pane" && args[1] === "run") {
        const p = readPiLaunchScriptPath(args[3]);
        capture.track(p);
        attempt += 1;
        return { ok: false, message: "connection reset" };
      }
      if (args[0] === "agent" && args[1] === "list") {
        return { ok: true, stdout: '{"result":{"type":"agent_list","agents":[]}}' };
      }
      if (args[0] === "worktree") {
        return {
          ok: true,
          stdout:
            '{"result":{"type":"worktree_opened","workspace":{"workspace_id":"workspace-1"},"root_pane":{"pane_id":"workspace-1:pane-1"},"already_open":true}}',
        };
      }
      if (args[0] === "pane" && args[1] === "read") return { ok: true, stdout: "" };
      if (args[0] === "pane" && args[1] === "process-info") return { ok: true, stdout: "" };
      return { ok: true, stdout: "{}" };
    };

    const host = openHerdrInteractiveSessionHost(execute, {
      readinessTimeoutMs: 5,
      readinessPollMs: 1,
    });

    const first = await host.launch({
      changeId: "change-123",
      repositoryPath: "/repository",
      worktreePath: "/workspace/change-123",
      initialPrompt: undefined,
    });
    expect(first.ok).toBe(false);
    expect(capture.paths).toHaveLength(1);
    const firstPath = capture.paths[0]!;
    expect(existsSync(firstPath)).toBe(true);
    expect(pendingHerdrLaunchArtifactsForTesting()).toBe(1);

    const second = await host.launch({
      changeId: "change-123",
      repositoryPath: "/repository",
      worktreePath: "/workspace/change-123",
      initialPrompt: undefined,
    });
    expect(second.ok).toBe(false);
    expect(capture.paths).toHaveLength(2);
    const secondPath = capture.paths[1]!;
    // First obsolete artifact was released before second attempt completed
    expect(existsSync(firstPath)).toBe(false);
    expect(existsSync(secondPath)).toBe(true);
    expect(pendingHerdrLaunchArtifactsForTesting()).toBe(1);

    await flushHerdrLaunchArtifactsForTesting();
    expect(existsSync(secondPath)).toBe(false);
    expect(pendingHerdrLaunchArtifactsForTesting()).toBe(0);
    capture.cleanup();
  });

  it("distinguishes temporary launch artifacts from intentionally retained diagnostics", async () => {
    const capture = captureLaunchScripts();
    const execute: HerdrCommandExecutor = async (args) => {
      if (args[0] === "pane" && args[1] === "run") {
        capture.track(readPiLaunchScriptPath(args[3]));
        return { ok: true, stdout: "{}" };
      }
      if (args[0] === "agent" && args[1] === "list") {
        // Never detect Pi, cause readiness failure
        return { ok: true, stdout: '{"result":{"type":"agent_list","agents":[]}}' };
      }
      if (args[0] === "worktree") {
        return {
          ok: true,
          stdout:
            '{"result":{"type":"worktree_opened","workspace":{"workspace_id":"workspace-1"},"root_pane":{"pane_id":"workspace-1:pane-1"},"already_open":false}}',
        };
      }
      if (args[0] === "pane" && args[1] === "read") {
        return { ok: true, stdout: "diagnostic startup log" };
      }
      if (args[0] === "pane" && args[1] === "process-info") {
        return { ok: true, stdout: "exit code 1" };
      }
      return { ok: true, stdout: "{}" };
    };

    const result = await openHerdrInteractiveSessionHost(execute, {
      readinessTimeoutMs: 5,
      readinessPollMs: 1,
    }).launch({
      changeId: "change-123",
      repositoryPath: "/repository",
      worktreePath: "/workspace/change-123",
      initialPrompt: undefined,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "launch_indeterminate",
      evidence: { startupOutput: "diagnostic startup log", exitEvidence: "exit code 1" },
    });
    // Diagnostics remain available, launch artifact does not
    expect(capture.paths).toHaveLength(1);
    expect(existsSync(capture.paths[0]!)).toBe(false);
    expect(pendingHerdrLaunchArtifactsForTesting()).toBe(0);
    capture.cleanup();
  });

  it("preserves Herdr launch inputs and classifications when cleanup succeeds", async () => {
    const commands: string[][] = [];
    let launchScript = "";
    const execute: HerdrCommandExecutor = async (args) => {
      commands.push([...args]);
      if (args[0] === "pane" && args[1] === "run") {
        const p = readPiLaunchScriptPath(args[3]);
        if (p) launchScript = readFileSync(p, "utf8");
      }
      if (args[0] === "agent" && args[1] === "list") {
        return commands.some(([c, o]) => c === "pane" && o === "run")
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
            '{"result":{"type":"worktree_opened","workspace":{"workspace_id":"workspace-1"},"root_pane":{"pane_id":"workspace-1:pane-1"},"already_open":false}}',
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

    const result = await openHerdrInteractiveSessionHost(execute).launch({
      changeId: "change-123",
      repositoryPath: "/repository",
      worktreePath: "/workspace/change-123",
      systemPrompt: "system",
      initialPrompt: "prompt",
    });

    expect(result).toEqual({ ok: true, host: "herdr", status: "started" });
    expect(commands.map((c) => c.slice(0, 3))).toEqual([
      ["agent", "list"],
      ["worktree", "open", "--cwd"],
      ["agent", "list"],
      ["pane", "run", "workspace-1:pane-1"],
      ["agent", "list"],
      ["agent", "rename", "workspace-1:pane-1"],
    ]);
    expect(launchScript).toContain("system");
    expect(launchScript).toContain("prompt");
    await flushHerdrLaunchArtifactsForTesting();
  });
});
