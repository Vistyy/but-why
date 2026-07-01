import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { repoStateLoadError, runtimeError, success, usageError } from "../src/cliResults.js";
import { openRepoState } from "../src/repoState.js";
import type { GitHubPrTarget } from "../src/run/run.js";
import { loadRepoSubmitPreflight } from "../src/submit/submitPreflight.js";
import { publicTaskId } from "../src/task/taskId.js";
import { cleanupTempRoots, createGitRepo, runByInProcess } from "./support/by-cli.js";

const firstNow = "2026-06-30T12:00:00.000Z";
const secondNow = "2026-06-30T12:05:00.000Z";
const thirdNow = "2026-06-30T12:10:00.000Z";

const prTarget: GitHubPrTarget = {
  owner: "acme",
  repo: "widgets",
  baseBranch: "main",
  remoteName: "origin",
  remoteUrl: "https://github.com/acme/widgets.git",
};

afterEach(cleanupTempRoots);

describe("module seams", () => {
  it("constructs shared CLI result objects without serialization concerns", () => {
    expect(success({ ok: true })).toEqual({
      exitCode: 0,
      stdout: { ok: true },
    });
    expect(
      usageError({ code: "bad_args", message: "Bad arguments.", help: ["Fix the command."] }),
    ).toEqual({
      exitCode: 2,
      stdout: {
        error: { code: "bad_args", message: "Bad arguments." },
        help: ["Fix the command."],
      },
    });
    expect(
      runtimeError({ code: "failed", message: "Command failed.", help: ["Try again."] }),
    ).toEqual({
      exitCode: 1,
      stdout: {
        error: { code: "failed", message: "Command failed." },
        help: ["Try again."],
      },
    });
    expect(repoStateLoadError({ code: "state_store_unavailable", taskPrefix: "BY" })).toEqual({
      exitCode: 1,
      stdout: {
        error: {
          code: "state_store_unavailable",
          message: "Repo-local But Why? state is unavailable.",
        },
        help: ["Move or restore .but-why/state.sqlite, then run `by init --task-prefix BY`."],
      },
    });
  });

  it("persists Task branch binding, Run creation, and Task state in one repo-state call", () => {
    const root = initializedRepo();
    const repoState = openRepoState({
      statePath: join(root, ".but-why/state.sqlite"),
      taskPrefix: "BY",
    });
    const task = repoState.createTask({
      title: "Submit through state",
      description: "Description",
      now: firstNow,
    });
    const taskId = publicTaskId(task.id);

    expect(
      repoState.transitionTaskState({ taskId, to: "implementing", now: secondNow }),
    ).toMatchObject({ ok: true, changed: true });

    expect(
      repoState.createRunFromSubmitPreflight({
        taskId,
        branch: "feature/by-1",
        commitSha: "abc123",
        prTarget,
        now: thirdNow,
      }),
    ).toEqual({ ok: true, runId: "BY-1.1", taskState: "validating" });
    expect(repoState.getTaskById(taskId)).toMatchObject({
      id: "BY-1",
      state: "validating",
      branch: "feature/by-1",
      latestRun: "BY-1.1",
      updatedAt: thirdNow,
    });

    expect(
      repoState.transitionTaskState({ taskId, to: "needs_input", now: thirdNow }),
    ).toMatchObject({ ok: true });
    expect(
      repoState.createRunFromSubmitPreflight({
        taskId,
        branch: "feature/by-1",
        commitSha: "def456",
        prTarget,
        now: thirdNow,
      }),
    ).toEqual({ ok: false, code: "TASK_HAS_ACTIVE_RUN" });
  });

  it("returns submit preflight domain rejections before Git facts are read", () => {
    const root = initializedRepo();
    const repoState = openRepoState({
      statePath: join(root, ".but-why/state.sqlite"),
      taskPrefix: "BY",
    });
    const task = repoState.createTask({
      title: "Not started",
      description: "Description",
      now: firstNow,
    });
    const submitPreflight = loadRepoSubmitPreflight(root);

    if (!submitPreflight.ok) {
      throw new Error(`Could not load submit preflight: ${submitPreflight.error.code}`);
    }

    expect(
      submitPreflight.submit.submitTask({ taskId: publicTaskId(task.id), now: secondNow }),
    ).toEqual({
      ok: false,
      kind: "preflight_rejection",
      code: "TASK_STATE_NOT_SUBMITTABLE",
      taskId: "BY-1",
      state: "todo",
    });
    expect(repoState.getTaskById(publicTaskId(task.id))).toMatchObject({
      state: "todo",
      branch: null,
      latestRun: null,
    });
  });
});

const initializedRepo = (): string => {
  const root = createGitRepo();
  const result = runByInProcess(root, ["init", "--task-prefix", "BY"]);

  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");

  return root;
};
