import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runTestProcess } from "../support/testProcess.js";

const { BY_RUN_REAL_HERDR_INTEGRATION } = process.env;
const realHerdrEnabled = BY_RUN_REAL_HERDR_INTEGRATION === "1";

const execute = (
  command: string,
  args: readonly string[],
  cwd: string,
  isolatedHome: string,
): string => {
  const result = runTestProcess(command, args, { cwd, isolatedHome, timeout: 180_000 });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
  return result.stdout;
};

type HerdrWorkspace = Readonly<Record<string, unknown>> & { readonly workspace_id: unknown };

const workspaceList = (cwd: string, isolatedHome: string): readonly HerdrWorkspace[] => {
  const response = JSON.parse(execute("herdr", ["workspace", "list"], cwd, isolatedHome)) as {
    readonly result?: { readonly type?: string; readonly workspaces?: unknown };
  };
  if (response.result?.type !== "workspace_list" || !Array.isArray(response.result.workspaces)) {
    throw new Error("Herdr returned malformed workspace-list output.");
  }
  return response.result.workspaces as readonly HerdrWorkspace[];
};

describe.skipIf(!realHerdrEnabled)("Change Implement with installed Herdr", () => {
  it("launches the exact normal flow in a standalone workspace rooted at the Managed Worktree", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "but-why-real-herdr-"));
    const repositoryPath = join(temporaryRoot, "repository");
    const isolatedHome = join(temporaryRoot, "home");
    const candidatePath = resolve("dist/main.js");
    const globalConfigDirectory = join(isolatedHome, ".config/but-why");
    mkdirSync(globalConfigDirectory, { recursive: true });
    const profile = {
      agentRuntime: "pi",
      runtimeConfig: { model: "openai-codex/gpt-5.6-luna" },
    } as const;
    writeFileSync(
      join(globalConfigDirectory, "config.json"),
      JSON.stringify({
        defaultAgentProfile: { scope: "global", name: "pi" },
        interactiveSession: { agentProfile: { scope: "global", name: "implementer" } },
        review: {
          acceptance: { agentProfile: { scope: "global", name: "reviewer" } },
          task: { agentProfile: { scope: "global", name: "task-reviewer" } },
        },
        agentProfiles: {
          pi: profile,
          implementer: profile,
          reviewer: profile,
          "task-reviewer": profile,
        },
      }),
      "utf8",
    );
    const baselineWorkspaceIds = new Set(
      workspaceList(temporaryRoot, isolatedHome).map((workspace) => String(workspace.workspace_id)),
    );
    let createdWorkspaceId: string | undefined;

    try {
      execute(
        "git",
        ["clone", "--depth", "1", "https://github.com/Vistyy/but-why.git", repositoryPath],
        temporaryRoot,
        isolatedHome,
      );
      execute(
        process.execPath,
        [candidatePath, "init", "--id-prefix", "BY"],
        repositoryPath,
        isolatedHome,
      );
      execute(process.execPath, [candidatePath, "change", "start"], repositoryPath, isolatedHome);
      const implementation = JSON.parse(
        execute(
          process.execPath,
          [candidatePath, "change", "implement", "BY-C1"],
          repositoryPath,
          isolatedHome,
        ),
      ) as Readonly<Record<string, unknown>> & { readonly worktreePath?: unknown };

      expect(implementation).toMatchObject({
        changeId: "BY-C1",
        host: "herdr",
        status: "started",
      });
      const worktreePath = implementation.worktreePath;
      expect(typeof worktreePath).toBe("string");

      const createdWorkspaces = workspaceList(temporaryRoot, isolatedHome).filter(
        (workspace) => !baselineWorkspaceIds.has(String(workspace.workspace_id)),
      );
      expect(createdWorkspaces).toHaveLength(1);
      const workspace = createdWorkspaces[0];
      createdWorkspaceId = String(workspace?.workspace_id);
      expect(workspace).toMatchObject({ label: "by-c1" });
      expect(workspace).not.toHaveProperty("worktree");

      const paneResponse = JSON.parse(
        execute(
          "herdr",
          ["pane", "list", "--workspace", createdWorkspaceId],
          temporaryRoot,
          isolatedHome,
        ),
      ) as { readonly result?: { readonly type?: string; readonly panes?: unknown } };
      expect(paneResponse.result?.type).toBe("pane_list");
      expect(paneResponse.result?.panes).toEqual([
        expect.objectContaining({ cwd: worktreePath, workspace_id: createdWorkspaceId }),
      ]);
      console.info(
        `real Herdr normal flow verified standalone workspace ${createdWorkspaceId} at ${String(worktreePath)}`,
      );
    } finally {
      try {
        const newWorkspaceIds = workspaceList(temporaryRoot, isolatedHome)
          .map((workspace) => String(workspace.workspace_id))
          .filter((workspaceId) => !baselineWorkspaceIds.has(workspaceId));
        for (const workspaceId of newWorkspaceIds) {
          execute("herdr", ["workspace", "close", workspaceId], temporaryRoot, isolatedHome);
        }
      } catch {
        // Preserve the primary verification failure.
      }
      rmSync(temporaryRoot, { force: true, recursive: true });
    }
  }, 240_000);
});
