import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { openRepoLocalStores } from "../src/init/repoLocalStores.js";
import { loadRepoLocalContext } from "../src/init/repoContext.js";
import { taskSlugForId, publicTaskId } from "../src/task/taskId.js";
import {
  cleanupTempRoots,
  createGitRepo,
  createTempRoot,
  runByInProcess,
} from "./support/by-cli.js";

const now = "2026-06-30T12:00:00.000Z";

afterEach(cleanupTempRoots);

describe("by task start managed worktree", () => {
  it("creates the Task Change, branch, and persistent worktree from the local default branch", () => {
    const root = initializedRepository();
    createApprovedTask(root);
    writeFileSync(join(root, "dirty.txt"), "caller work is not part of Task Start\n");

    const result = runByInProcess(root, ["task", "start", "BY-1", "--output", "json"], now);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    const output = JSON.parse(result.stdout) as {
      readonly task: { readonly id: string; readonly state: string; readonly changed: boolean };
      readonly change: { readonly id: string };
      readonly branch: string;
      readonly startingCommit: string;
      readonly worktreePath: string;
      readonly next: { readonly workingDirectory: string; readonly command: string };
    };
    const slug = taskSlugForId(publicTaskId("BY-1"));
    const commonDirectory = git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
    const startingCommit = git(root, "rev-parse", "refs/heads/main^{commit}");

    expect(output).toMatchObject({
      task: { id: "BY-1", state: "implementing", changed: true },
      change: { id: expect.any(String) },
      branch: `refs/heads/but-why/${slug}`,
      startingCommit,
      worktreePath: join(commonDirectory, "but-why", "worktrees", slug),
      next: {
        workingDirectory: join(commonDirectory, "but-why", "worktrees", slug),
        command: "by submit BY-1",
      },
    });
    expect(existsSync(output.worktreePath)).toBe(true);
    expect(git(output.worktreePath, "symbolic-ref", "HEAD")).toBe(output.branch);
    expect(git(output.worktreePath, "rev-parse", "HEAD^{commit}")).toBe(startingCommit);
    expect(existsSync(join(output.worktreePath, "dirty.txt"))).toBe(false);
    expect(readFileSync(join(output.worktreePath, ".but-why", "config.json"), "utf8")).toContain(
      '"taskPrefix": "BY"',
    );
  });

  it("reuses the same Change, branch, worktree, and starting commit", () => {
    const root = initializedRepository();
    createApprovedTask(root);

    const first = runByInProcess(root, ["task", "start", "BY-1", "--output", "json"], now);
    const repeated = runByInProcess(root, ["task", "start", "BY-1", "--output", "json"], now);

    expect(first.status).toBe(0);
    expect(repeated.status).toBe(0);
    const firstOutput = JSON.parse(first.stdout);
    const repeatedOutput = JSON.parse(repeated.stdout);
    expect(repeatedOutput).toMatchObject({
      task: { id: "BY-1", state: "implementing", changed: false },
      change: firstOutput.change,
      branch: firstOutput.branch,
      startingCommit: firstOutput.startingCommit,
      worktreePath: firstOutput.worktreePath,
    });
    expect(
      git(root, "for-each-ref", "--format=%(refname)", `refs/heads/but-why/`)
        .split("\n")
        .filter(Boolean),
    ).toEqual([firstOutput.branch]);
  });

  it("rejects repeated Start after implementation has advanced", () => {
    const root = initializedRepository();
    createApprovedTask(root);
    expect(runByInProcess(root, ["task", "start", "BY-1"], now).status).toBe(0);
    const context = loadRepoLocalContext(root, () => now);
    if (!context.ok) throw new Error(`Could not load repository: ${context.error.code}`);
    const taskStore = openRepoLocalStores(context.context, () => now).taskStore;

    for (const state of ["validating", "ready", "done"] as const) {
      expect(
        taskStore.transitionTaskState({ taskId: publicTaskId("BY-1"), to: state, now }).ok,
      ).toBe(true);
      const repeated = runByInProcess(root, ["task", "start", "BY-1", "--output", "json"], now);
      expect(repeated.status).toBe(1);
      expect(JSON.parse(repeated.stdout)).toMatchObject({
        error: { code: "invalid_task_state", taskId: "BY-1", state },
      });
    }
  });

  it("recreates a missing recorded worktree without creating another Change", () => {
    const root = initializedRepository();
    createApprovedTask(root);
    const first = JSON.parse(
      runByInProcess(root, ["task", "start", "BY-1", "--output", "json"], now).stdout,
    );
    git(root, "worktree", "remove", first.worktreePath);

    const recovered = runByInProcess(root, ["task", "start", "BY-1", "--output", "json"], now);

    expect(recovered.status).toBe(0);
    expect(JSON.parse(recovered.stdout)).toMatchObject({
      task: { changed: false },
      change: first.change,
      branch: first.branch,
      startingCommit: first.startingCommit,
      worktreePath: first.worktreePath,
    });
    expect(git(first.worktreePath, "symbolic-ref", "HEAD")).toBe(first.branch);
  });

  it("repairs a stale Git registration after the recorded worktree directory is deleted", () => {
    const root = initializedRepository();
    createApprovedTask(root);
    const first = JSON.parse(
      runByInProcess(root, ["task", "start", "BY-1", "--output", "json"], now).stdout,
    );
    rmSync(first.worktreePath, { recursive: true });
    expect(git(root, "worktree", "list", "--porcelain")).toContain(
      `worktree ${first.worktreePath}`,
    );
    expect(git(root, "worktree", "list", "--porcelain")).toContain("prunable");

    const recovered = runByInProcess(root, ["task", "start", "BY-1", "--output", "json"], now);

    expect(recovered.status).toBe(0);
    expect(JSON.parse(recovered.stdout)).toMatchObject({
      task: { changed: false },
      change: first.change,
      branch: first.branch,
      startingCommit: first.startingCommit,
      worktreePath: first.worktreePath,
    });
    expect(git(first.worktreePath, "symbolic-ref", "HEAD")).toBe(first.branch);
  });

  it("reuses the same Task Start when invoked from another linked worktree", () => {
    const root = initializedRepository();
    createApprovedTask(root);
    const linked = join(createTempRoot(), "linked");
    git(root, "worktree", "add", "-q", "-b", "caller", linked, "main");
    const first = JSON.parse(
      runByInProcess(root, ["task", "start", "BY-1", "--output", "json"], now).stdout,
    );

    const repeated = runByInProcess(linked, ["task", "start", "BY-1", "--output", "json"], now);

    expect(repeated.status).toBe(0);
    expect(JSON.parse(repeated.stdout)).toMatchObject({
      task: { id: "BY-1", state: "implementing", changed: false },
      change: first.change,
      branch: first.branch,
      startingCommit: first.startingCommit,
      worktreePath: first.worktreePath,
      next: { workingDirectory: first.worktreePath, command: "by submit BY-1" },
    });
    const context = loadRepoLocalContext(linked, () => now);
    if (!context.ok) throw new Error(`Could not load linked repository: ${context.error.code}`);
    expect(
      openRepoLocalStores(context.context, () => now).taskStartStore.getByTaskId(
        publicTaskId("BY-1"),
      )?.acceptanceContext,
    ).toEqual({
      version: 1,
      title: "Managed worktree",
      description: "Implement the managed worktree boundary.\n",
      comments: [],
    });
    expect(git(first.worktreePath, "symbolic-ref", "HEAD")).toBe(first.branch);
  });

  it("requires a valid Repo Config in the local default branch commit", () => {
    const root = initializedRepository(false);
    createApprovedTask(root);

    const result = runByInProcess(root, ["task", "start", "BY-1", "--output", "json"], now);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      error: {
        code: "committed_repo_config_missing",
        taskId: "BY-1",
      },
    });
    expect(runByInProcess(root, ["task", "show", "BY-1"]).stdout).toContain("state: todo");
  });

  it("rejects invalid Repo Config committed on the local default branch", () => {
    const root = initializedRepository();
    writeFileSync(join(root, ".but-why", "config.json"), '{"taskPrefix":"bad"}\n');
    git(root, "add", ".but-why/config.json");
    git(root, "commit", "-m", "Commit invalid config");
    writeFileSync(join(root, ".but-why", "config.json"), '{"taskPrefix":"BY"}\n');
    createApprovedTask(root);

    const result = runByInProcess(root, ["task", "start", "BY-1", "--output", "json"], now);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      error: { code: "committed_repo_config_invalid", taskId: "BY-1" },
    });
    expect(runByInProcess(root, ["task", "show", "BY-1"]).stdout).toContain("state: todo");
  });

  it("captures the approved Task Context once as immutable Acceptance Context", () => {
    const root = initializedRepository();
    createApprovedTask(root);
    writeFileSync(join(root, "comment.md"), "Keep this acceptance detail.\n");
    expect(
      runByInProcess(root, ["task", "comment", "BY-1", "--file", "comment.md"], now).status,
    ).toBe(0);

    expect(runByInProcess(root, ["task", "start", "BY-1"], now).status).toBe(0);

    const context = loadRepoLocalContext(root, () => now);
    if (!context.ok) throw new Error(`Could not load repository: ${context.error.code}`);
    const start = openRepoLocalStores(context.context, () => now).taskStartStore.getByTaskId(
      publicTaskId("BY-1"),
    );
    expect(start?.acceptanceContext).toEqual({
      version: 1,
      title: "Managed worktree",
      description: "Implement the managed worktree boundary.\n",
      comments: ["Keep this acceptance detail.\n"],
    });

    writeFileSync(join(root, "late.md"), "This must not enter Acceptance Context.\n");
    expect(runByInProcess(root, ["task", "comment", "BY-1", "--file", "late.md"], now).status).toBe(
      1,
    );
    expect(
      openRepoLocalStores(context.context, () => now).taskStartStore.getByTaskId(
        publicTaskId("BY-1"),
      )?.acceptanceContext,
    ).toEqual(start?.acceptanceContext);
  });

  it("preserves an unexpected branch and returns an actionable conflict", () => {
    const root = initializedRepository();
    createApprovedTask(root);
    const slug = taskSlugForId(publicTaskId("BY-1"));
    const branch = `refs/heads/but-why/${slug}`;
    git(root, "branch", `but-why/${slug}`, "refs/heads/main");
    const originalCommit = git(root, "rev-parse", `${branch}^{commit}`);

    const result = runByInProcess(root, ["task", "start", "BY-1", "--output", "json"], now);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      error: { code: "task_start_conflict", taskId: "BY-1" },
      help: [expect.stringContaining("without deleting or overwriting")],
    });
    expect(git(root, "rev-parse", `${branch}^{commit}`)).toBe(originalCommit);
    expect(runByInProcess(root, ["task", "show", "BY-1"]).stdout).toContain("state: todo");
  });

  it("preserves a dangling symlink at the managed worktree path as a conflict", () => {
    const root = initializedRepository();
    createApprovedTask(root);
    const slug = taskSlugForId(publicTaskId("BY-1"));
    const commonDirectory = git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
    const worktreePath = join(commonDirectory, "but-why", "worktrees", slug);
    mkdirSync(join(commonDirectory, "but-why", "worktrees"), { recursive: true });
    symlinkSync(join(commonDirectory, "missing-target"), worktreePath);

    const result = runByInProcess(root, ["task", "start", "BY-1", "--output", "json"], now);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      error: { code: "task_start_conflict", taskId: "BY-1", worktreePath },
    });
    expect(lstatSync(worktreePath).isSymbolicLink()).toBe(true);
  });

  it("preserves an occupied worktree path and recovers the durable Task Start", () => {
    const root = initializedRepository();
    createApprovedTask(root);
    const slug = taskSlugForId(publicTaskId("BY-1"));
    const commonDirectory = git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
    const worktreePath = join(commonDirectory, "but-why", "worktrees", slug);
    mkdirSync(worktreePath, { recursive: true });
    writeFileSync(join(worktreePath, "keep.txt"), "do not overwrite\n");

    const conflicted = runByInProcess(root, ["task", "start", "BY-1", "--output", "json"], now);

    expect(conflicted.status).toBe(1);
    expect(JSON.parse(conflicted.stdout)).toMatchObject({
      error: { code: "task_start_conflict", taskId: "BY-1" },
    });
    expect(readFileSync(join(worktreePath, "keep.txt"), "utf8")).toBe("do not overwrite\n");
    expect(runByInProcess(root, ["task", "show", "BY-1"]).stdout).toContain("state: implementing");

    rmSync(worktreePath, { recursive: true });
    const recovered = runByInProcess(root, ["task", "start", "BY-1"], now);
    expect(recovered.status).toBe(0);
    expect(existsSync(worktreePath)).toBe(true);
  });
});

const initializedRepository = (commitConfig = true): string => {
  const root = createGitRepo();
  git(root, "config", "user.name", "But Why Test");
  git(root, "config", "user.email", "but-why@example.test");
  git(root, "branch", "-M", "main");

  expect(runByInProcess(root, ["init", "--task-prefix", "BY"], now).status).toBe(0);
  writeFileSync(join(root, "README.md"), "# Test repository\n");
  git(root, "add", "README.md", ".gitignore");
  if (commitConfig) git(root, "add", ".but-why/config.json");
  git(root, "commit", "-m", "Initialize repository");
  git(root, "remote", "add", "origin", root);
  git(root, "update-ref", "refs/remotes/origin/main", "refs/heads/main");
  git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  return root;
};

const createApprovedTask = (root: string): void => {
  writeFileSync(join(root, "task.md"), "Implement the managed worktree boundary.\n");
  expect(
    runByInProcess(root, [
      "task",
      "create",
      "--title",
      "Managed worktree",
      "--description-file",
      "task.md",
    ]).status,
  ).toBe(0);
  expect(runByInProcess(root, ["task", "approve", "BY-1"], now).status).toBe(0);
};

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
