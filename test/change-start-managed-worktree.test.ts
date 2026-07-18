import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { openRepoLocalStores } from "../src/init/repoLocalStores.js";
import { loadRepoLocalContext } from "../src/init/repoContext.js";
import { publicTaskId } from "../src/task/taskId.js";
import { cleanupTempRoots, runByInProcess, runByInProcessAsync, runByWithEnv } from "./support/by-cli.js";
import { createInitializedRepo } from "./support/initializedRepo.js";

const now = "2026-06-30T12:00:00.000Z";

afterEach(cleanupTempRoots);

describe("by change start managed worktree", () => {
  it("creates a ready taskless Change from the local default branch", async () => {
    const root = initializedRepository();
    writeFileSync(join(root, "dirty.txt"), "caller work is not part of Change Start\n");

    const result = await runByInProcessAsync(
      root,
      ["change", "start", "--output", "json"],
      now,
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const output = JSON.parse(result.stdout) as ChangeOutput;
    const startingCommit = git(root, "rev-parse", "refs/heads/main^{commit}");

    expect(output).toMatchObject({
      change: { id: expect.any(String), taskId: null, readiness: "ready" },
      branch: expect.stringMatching(/^refs\/heads\/but-why\/change-/u),
      baseRef: "refs/heads/main",
      startingCommit,
      worktreePath: expect.any(String),
    });
    expect(existsSync(output.worktreePath)).toBe(true);
    expect(git(output.worktreePath, "symbolic-ref", "HEAD")).toBe(output.branch);
    expect(git(output.worktreePath, "rev-parse", "HEAD^{commit}")).toBe(startingCommit);
    expect(existsSync(join(output.worktreePath, "dirty.txt"))).toBe(false);
  });

  it("creates a Task-backed Change with immutable Acceptance Context", async () => {
    const root = initializedRepository();
    createApprovedTask(root);

    const result = await runByInProcessAsync(
      root,
      ["change", "start", "--task", "BY-1", "--output", "json"],
      now,
    );

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as ChangeOutput;
    expect(output.change).toMatchObject({ taskId: "BY-1", readiness: "ready" });
    expect(runByInProcess(root, ["task", "show", "BY-1"]).stdout).toContain(
      "state: implementing",
    );

    const context = loadRepoLocalContext(root, () => now);
    if (!context.ok) throw new Error(context.error.code);
    expect(openRepoLocalStores(context.context).changeStartStore.getById(output.change.id)).toMatchObject({
      acceptanceContext: {
        version: 1,
        title: "Prepared change",
        description: "Prepare this Change.\n",
        comments: [],
      },
    });
  });

  it("preserves a failed preparation and retries it in the same worktree", async () => {
    const root = initializedRepository(
      "if [ -f .prepare-attempted ]; then exit 0; else touch .prepare-attempted; printf failed >&2; exit 7; fi",
    );

    const started = await runByInProcessAsync(
      root,
      ["change", "start", "--output", "json"],
      now,
    );

    expect(started.status).toBe(1);
    const failure = JSON.parse(started.stdout);
    expect(failure).toMatchObject({
      error: {
        code: "prepare_failed",
        changeId: expect.any(String),
        readiness: "prepare_failed",
        exitCode: 7,
        timedOut: false,
        stderr: "failed",
        worktreePath: expect.any(String),
      },
    });
    expect(existsSync(failure.error.worktreePath)).toBe(true);

    const retried = await runByInProcessAsync(
      root,
      ["change", "prepare", failure.error.changeId, "--output", "json"],
      now,
    );

    expect(retried.status).toBe(0);
    expect(JSON.parse(retried.stdout)).toMatchObject({
      change: {
        id: failure.error.changeId,
        readiness: "ready",
      },
      worktreePath: failure.error.worktreePath,
    });
  });

  it("removes the Task Start route and supports executable JSON output", async () => {
    const root = initializedRepository();
    createApprovedTask(root);

    const retired = runByInProcess(root, ["task", "start", "BY-1", "--output", "json"]);
    expect(retired.status).toBe(2);
    expect(JSON.parse(retired.stdout)).toMatchObject({ error: { code: "unknown_command" } });

    const executable = runByWithEnv(
      root,
      { BUT_WHY_NOW: now },
      "change",
      "start",
      "--task",
      "BY-1",
      "--output",
      "json",
    );
    expect(executable.status).toBe(0);
    expect(JSON.parse(executable.stdout)).toMatchObject({
      change: { taskId: "BY-1", readiness: "ready" },
    });
  });
});

type ChangeOutput = {
  readonly change: { readonly id: string; readonly taskId: string | null; readonly readiness: string };
  readonly branch: string;
  readonly baseRef: string;
  readonly startingCommit: string;
  readonly worktreePath: string;
};

const initializedRepository = (prepare?: string): string => {
  const root = createInitializedRepo();
  git(root, "config", "user.name", "But Why Test");
  git(root, "config", "user.email", "but-why@example.test");
  git(root, "branch", "-M", "main");

  if (prepare !== undefined) {
    writeFileSync(
      join(root, ".but-why", "config.json"),
      `${JSON.stringify({ taskPrefix: "BY", prepare: { command: prepare } }, null, 2)}\n`,
    );
  }
  writeFileSync(join(root, "README.md"), "# Test repository\n");
  git(root, "add", "README.md", ".gitignore", ".but-why/config.json");
  git(root, "commit", "-m", "Initialize repository");
  git(root, "remote", "add", "origin", root);
  git(root, "update-ref", "refs/remotes/origin/main", "refs/heads/main");
  git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  return root;
};

const createApprovedTask = (root: string): void => {
  const context = loadRepoLocalContext(root, () => now);
  if (!context.ok) throw new Error(context.error.code);
  const store = openRepoLocalStores(context.context).taskStore;
  const task = store.createTask({
    title: "Prepared change",
    description: "Prepare this Change.\n",
    now,
  });
  expect(store.approveTask({ taskId: publicTaskId(task.id), now }).ok).toBe(true);
};

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
