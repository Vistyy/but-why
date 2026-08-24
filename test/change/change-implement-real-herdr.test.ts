import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const { BY_RUN_REAL_HERDR_INTEGRATION } = process.env;
const realHerdrEnabled = BY_RUN_REAL_HERDR_INTEGRATION === "1";

const execute = (command: string, args: readonly string[], cwd?: string): string => {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      env: process.env,
      timeout: 180_000,
      ...(cwd === undefined ? {} : { cwd }),
    });
  } catch (error) {
    const output = error as { readonly stdout?: unknown; readonly stderr?: unknown };
    throw new Error(
      `${command} ${args.join(" ")} failed\nstdout: ${String(output.stdout ?? "")}\nstderr: ${String(output.stderr ?? "")}`,
      { cause: error },
    );
  }
};

type HerdrWorkspace = Readonly<Record<string, unknown>> & { readonly workspace_id: unknown };

const workspaceList = (): readonly HerdrWorkspace[] => {
  const response = JSON.parse(execute("herdr", ["workspace", "list"])) as {
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
    const candidatePath = resolve("dist/main.js");
    const baselineWorkspaceIds = new Set(
      workspaceList().map((workspace) => String(workspace.workspace_id)),
    );
    let createdWorkspaceId: string | undefined;

    try {
      execute("git", [
        "clone",
        "--depth",
        "1",
        "https://github.com/Vistyy/but-why.git",
        repositoryPath,
      ]);
      execute(process.execPath, [candidatePath, "init", "--id-prefix", "BY"], repositoryPath);
      execute(process.execPath, [candidatePath, "change", "start"], repositoryPath);
      const implementation = JSON.parse(
        execute(process.execPath, [candidatePath, "change", "implement", "BY-C1"], repositoryPath),
      ) as Readonly<Record<string, unknown>> & { readonly worktreePath?: unknown };

      expect(implementation).toMatchObject({
        changeId: "BY-C1",
        host: "herdr",
        status: "started",
      });
      const worktreePath = implementation.worktreePath;
      expect(typeof worktreePath).toBe("string");

      const createdWorkspaces = workspaceList().filter(
        (workspace) => !baselineWorkspaceIds.has(String(workspace.workspace_id)),
      );
      expect(createdWorkspaces).toHaveLength(1);
      const workspace = createdWorkspaces[0];
      createdWorkspaceId = String(workspace?.workspace_id);
      expect(workspace).toMatchObject({ label: "by-c1" });
      expect(workspace).not.toHaveProperty("worktree");

      const paneResponse = JSON.parse(
        execute("herdr", ["pane", "list", "--workspace", createdWorkspaceId]),
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
        const newWorkspaceIds = workspaceList()
          .map((workspace) => String(workspace.workspace_id))
          .filter((workspaceId) => !baselineWorkspaceIds.has(workspaceId));
        for (const workspaceId of newWorkspaceIds) {
          execute("herdr", ["workspace", "close", workspaceId]);
        }
      } catch {
        // Preserve the primary verification failure.
      }
      rmSync(temporaryRoot, { force: true, recursive: true });
    }
  }, 240_000);
});
