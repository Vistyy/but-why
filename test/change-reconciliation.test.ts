import { execFileSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { openRepoLocalStores } from "../src/init/repoLocalStores.js";
import { loadRepoLocalContext } from "../src/init/repoContext.js";
import { publicTaskId } from "../src/task/taskId.js";
import { cleanupTempRoots, createTempRoot, runByWithEnv } from "./support/by-cli.js";
import { createInitializedRepo } from "./support/initializedRepo.js";

const now = "2026-07-24T10:00:00.000Z";
const pathEnvironmentVariable = "PATH";

afterEach(cleanupTempRoots);

describe("by change reconcile", () => {
  it("returns an open owned PR at its expected head without mutation", () => {
    const repository = initializedRepository();
    const started = startChangeProcess(repository, "--output", "json");
    const change = JSON.parse(started.stdout) as {
      readonly change: { readonly id: string };
      readonly branch: string;
      readonly worktreePath: string;
    };
    const headSha = git(change.worktreePath, "rev-parse", "HEAD");
    const context = loadRepoLocalContext(repository, () => now);
    if (!context.ok) throw new Error(context.error.code);
    const store = openRepoLocalStores(context.context).changeStore;
    const target = { owner: "acme", repo: "widgets", baseBranch: "main", remoteName: "origin" };
    const headBranch = change.branch.slice("refs/heads/".length);
    expect(
      store.beginPublication({
        changeId: change.change.id,
        candidateId: "candidate-1",
        validationRunId: "validation-run-1",
        target,
        headBranch,
        expectedHeadSha: headSha,
        now,
      }).ok,
    ).toBe(true);
    expect(
      store.recordPublishedPullRequest({
        changeId: change.change.id,
        candidateId: "candidate-1",
        validationRunId: "validation-run-1",
        target,
        headBranch,
        expectedHeadSha: headSha,
        pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
        now,
      }).ok,
    ).toBe(true);

    const ghDirectory = createTempRoot();
    writeFileSync(
      join(ghDirectory, "gh"),
      `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify(openPullRequest(target, headBranch, headSha))}'\n`,
    );
    chmodSync(join(ghDirectory, "gh"), 0o755);

    const result = runByWithEnv(
      change.worktreePath,
      { PATH: `${ghDirectory}:${process.env[pathEnvironmentVariable] ?? ""}` },
      "change",
      "reconcile",
      change.change.id,
      "--output",
      "json",
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      changes: [
        {
          changeId: change.change.id,
          status: "open",
          pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
        },
      ],
    });
    expect(store.getChangeById(change.change.id)).toMatchObject({ state: "open" });
  });

  it("atomically completes a merged Change and its linked Task before cleanup", () => {
    const repository = initializedRepository();
    const context = loadRepoLocalContext(repository, () => now);
    if (!context.ok) throw new Error(context.error.code);
    const stores = openRepoLocalStores(context.context);
    const task = stores.taskStore.createTask({
      title: "Merged Change",
      description: "Complete me",
      now,
    });
    const taskId = publicTaskId(task.id);
    expect(stores.taskStore.approveTask({ taskId, now }).ok).toBe(true);
    const started = startChangeProcess(repository, "--task", taskId, "--output", "json");
    const change = JSON.parse(started.stdout) as {
      readonly change: { readonly id: string };
      readonly branch: string;
      readonly worktreePath: string;
    };
    const headSha = git(change.worktreePath, "rev-parse", "HEAD");
    const target = { owner: "acme", repo: "widgets", baseBranch: "main", remoteName: "origin" };
    const headBranch = change.branch.slice("refs/heads/".length);
    expect(
      stores.changeStore.beginPublication({
        changeId: change.change.id,
        candidateId: "candidate-1",
        validationRunId: "validation-run-1",
        target,
        headBranch,
        expectedHeadSha: headSha,
        now,
      }).ok,
    ).toBe(true);
    expect(
      stores.changeStore.recordPublishedPullRequest({
        changeId: change.change.id,
        candidateId: "candidate-1",
        validationRunId: "validation-run-1",
        target,
        headBranch,
        expectedHeadSha: headSha,
        pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
        now,
      }).ok,
    ).toBe(true);

    const result = reconcileWithPullRequest(
      repository,
      mergedPullRequest(target, headBranch, headSha),
      change.change.id,
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      changes: [
        {
          changeId: change.change.id,
          status: "completed",
          cleanup: { state: "complete", blockingReason: null },
        },
      ],
    });
    expect(stores.changeStore.getChangeById(change.change.id)).toMatchObject({
      state: "closed",
      closeReason: "completed",
      cleanup: { state: "complete", blockingReason: null },
    });
    expect(stores.taskStore.getTaskById(taskId)).toMatchObject({ state: "done" });
  });

  it("retains unsafe cleanup with its blocking reason after completing a merged Change", () => {
    const repository = initializedRepository();
    const started = startChangeProcess(repository, "--output", "json");
    const change = JSON.parse(started.stdout) as {
      readonly change: { readonly id: string };
      readonly branch: string;
      readonly worktreePath: string;
    };
    const headSha = git(change.worktreePath, "rev-parse", "HEAD");
    writeFileSync(join(change.worktreePath, "uncommitted.txt"), "preserve this work\n");
    const context = loadRepoLocalContext(repository, () => now);
    if (!context.ok) throw new Error(context.error.code);
    const store = openRepoLocalStores(context.context).changeStore;
    const target = { owner: "acme", repo: "widgets", baseBranch: "main", remoteName: "origin" };
    const headBranch = change.branch.slice("refs/heads/".length);
    expect(
      store.beginPublication({
        changeId: change.change.id,
        candidateId: "candidate-1",
        validationRunId: "validation-run-1",
        target,
        headBranch,
        expectedHeadSha: headSha,
        now,
      }).ok,
    ).toBe(true);
    expect(
      store.recordPublishedPullRequest({
        changeId: change.change.id,
        candidateId: "candidate-1",
        validationRunId: "validation-run-1",
        target,
        headBranch,
        expectedHeadSha: headSha,
        pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
        now,
      }).ok,
    ).toBe(true);

    const result = reconcileWithPullRequest(
      repository,
      mergedPullRequest(target, headBranch, headSha),
      change.change.id,
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      changes: [
        {
          changeId: change.change.id,
          status: "completed",
          cleanup: { state: "pending", blockingReason: "worktree_has_uncommitted_changes" },
        },
      ],
    });
    expect(store.getChangeById(change.change.id)).toMatchObject({
      state: "closed",
      cleanup: { state: "pending", blockingReason: "worktree_has_uncommitted_changes" },
    });
  });
});

const startChangeProcess = (repository: string, ...args: readonly string[]) =>
  runByWithEnv(repository, { BUT_WHY_NOW: now }, "change", "start", ...args);

const reconcileWithPullRequest = (repository: string, pullRequest: object, changeId: string) => {
  const ghDirectory = createTempRoot();
  writeFileSync(
    join(ghDirectory, "gh"),
    `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify(pullRequest)}'\n`,
  );
  chmodSync(join(ghDirectory, "gh"), 0o755);
  return runByWithEnv(
    repository,
    { PATH: `${ghDirectory}:${process.env[pathEnvironmentVariable] ?? ""}` },
    "change",
    "reconcile",
    changeId,
    "--output",
    "json",
  );
};

const initializedRepository = (): string => {
  const repository = createInitializedRepo();
  git(repository, "config", "user.name", "But Why Test");
  git(repository, "config", "user.email", "but-why@example.test");
  git(repository, "branch", "-M", "main");
  writeFileSync(join(repository, "README.md"), "# Test repository\n");
  git(repository, "add", "README.md", ".gitignore", ".but-why/config.json");
  git(repository, "commit", "-m", "Initialize repository");
  git(repository, "remote", "add", "origin", repository);
  git(repository, "update-ref", "refs/remotes/origin/main", "refs/heads/main");
  git(repository, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  return repository;
};

const openPullRequest = (
  target: { readonly owner: string; readonly repo: string; readonly baseBranch: string },
  headBranch: string,
  headSha: string,
) => ({
  number: 42,
  url: "https://github.com/acme/widgets/pull/42",
  state: "open",
  merged: false,
  base: { ref: target.baseBranch, repo: { owner: { login: target.owner }, name: target.repo } },
  head: { ref: headBranch, sha: headSha },
});

const mergedPullRequest = (
  target: { readonly owner: string; readonly repo: string; readonly baseBranch: string },
  headBranch: string,
  headSha: string,
) => ({ ...openPullRequest(target, headBranch, headSha), state: "closed", merged: true });

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
