import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { repoStateLoadError, runtimeError, success, usageError } from "../src/cliResults.js";
import type { GitHubPrTarget } from "../src/run/run.js";
import { openSqliteRunStore } from "../src/sqlite/sqliteRunStore.js";
import { openSqliteTaskStore } from "../src/sqlite/sqliteTaskStore.js";
import { openSqliteValidationRuns } from "../src/sqlite/sqliteValidationRuns.js";
import { unsupportedValidationRuns } from "../src/validation/validationRuns.js";
import { loadRepoSubmitPreflight } from "../src/repoSubmit/submitPreflight.js";
import { publicTaskId } from "../src/task/taskId.js";
import { cleanupTempRoots, createGitRepo, runByInProcess } from "./support/by-cli.js";

const firstNow = "2026-06-30T12:00:00.000Z";
const secondNow = "2026-06-30T12:05:00.000Z";
const thirdNow = "2026-06-30T12:10:00.000Z";
const firstTaskRunId = "by-1-09224d806043.1";

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

  it("starts local validation through the ValidationRuns seam", () => {
    const root = initializedRepo();
    const taskStore = sqliteTaskStore(root);
    const runStore = sqliteRunStore(root);
    const validationRuns = sqliteValidationRuns(root);
    const task = taskStore.createTask({
      title: "Submit through state",
      description: "Description",
      now: firstNow,
    });
    const taskId = publicTaskId(task.id);

    expect(
      taskStore.transitionTaskState({ taskId, to: "implementing", now: secondNow }),
    ).toMatchObject({ ok: true, changed: true });

    expect(
      validationRuns.start({
        taskId,
        branch: "feature/by-1",
        commitSha: "abc123",
        prTarget,
        now: thirdNow,
      }),
    ).toEqual({
      ok: true,
      runId: firstTaskRunId,
      taskState: "validating",
      previousTaskState: "implementing",
    });
    expect(taskStore.getTaskById(taskId)).toMatchObject({
      id: "BY-1",
      state: "validating",
      branch: "feature/by-1",
      updatedAt: thirdNow,
    });
    expect(runStore.getLatestRunIdForTask(taskId)).toBe(firstTaskRunId);

    expect(
      taskStore.transitionTaskState({ taskId, to: "needs_input", now: thirdNow }),
    ).toMatchObject({ ok: true });
    expect(
      validationRuns.start({
        taskId,
        branch: "feature/by-1",
        commitSha: "def456",
        prTarget,
        now: thirdNow,
      }),
    ).toEqual({ ok: false, code: "TASK_HAS_ACTIVE_RUN" });
    expect(taskStore.getTaskById(taskId)).toMatchObject({
      state: "needs_input",
      branch: "feature/by-1",
    });
    expect(runStore.getLatestRunIdForTask(taskId)).toBe(firstTaskRunId);
  });

  it("rejects invalid local validation starts through the ValidationRuns seam", () => {
    const root = initializedRepo();
    const taskStore = sqliteTaskStore(root);
    const runStore = sqliteRunStore(root);
    const validationRuns = sqliteValidationRuns(root);
    const task = taskStore.createTask({
      title: "Reject invalid starts",
      description: "Description",
      now: firstNow,
    });
    const taskId = publicTaskId(task.id);

    expect(
      validationRuns.start({
        taskId,
        branch: "feature/by-1",
        commitSha: "abc123",
        prTarget,
        now: secondNow,
      }),
    ).toEqual({ ok: false, code: "TASK_STATE_NOT_SUBMITTABLE", state: "todo" });
    expect(runStore.getLatestRunIdForTask(taskId)).toBeNull();

    expect(
      taskStore.transitionTaskState({ taskId, to: "implementing", now: secondNow }),
    ).toMatchObject({ ok: true });
    expect(
      validationRuns.start({
        taskId,
        branch: "feature/by-1",
        commitSha: "abc123",
        prTarget,
        now: thirdNow,
      }),
    ).toMatchObject({ ok: true });
    expect(runStore.recordRunError({ runId: firstTaskRunId, now: thirdNow })).toEqual({ ok: true });
    expect(
      taskStore.transitionTaskState({ taskId, to: "needs_input", now: thirdNow }),
    ).toMatchObject({ ok: true });

    expect(
      validationRuns.start({
        taskId,
        branch: "feature/other",
        commitSha: "def456",
        prTarget,
        now: thirdNow,
      }),
    ).toEqual({ ok: false, code: "TASK_BRANCH_MISMATCH", boundBranch: "feature/by-1" });
    expect(runStore.getLatestRunIdForTask(taskId)).toBe(firstTaskRunId);
  });

  it("rejects unsupported validation starts with a structured error", () => {
    const validationRuns = unsupportedValidationRuns();

    expect(
      validationRuns.start({
        taskId: publicTaskId("REMOTE-1"),
        branch: "feature/remote",
        commitSha: "abc123",
        prTarget,
        now: thirdNow,
      }),
    ).toEqual({ ok: false, code: "TASK_AUTHORITY_UNSUPPORTED" });
  });

  it("returns submit preflight domain rejections before Git facts are read", () => {
    const root = initializedRepo();
    const taskStore = sqliteTaskStore(root);
    const runStore = sqliteRunStore(root);
    const task = taskStore.createTask({
      title: "Not started",
      description: "Description",
      now: firstNow,
    });
    const submitPreflight = loadRepoSubmitPreflight(root, { migrationTimestamp: () => firstNow });

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
    expect(taskStore.getTaskById(publicTaskId(task.id))).toMatchObject({
      state: "todo",
      branch: null,
    });
    expect(runStore.getLatestRunIdForTask(publicTaskId(task.id))).toBeNull();
  });
});

const initializedRepo = (): string => {
  const root = createGitRepo();
  const result = runByInProcess(root, ["init", "--task-prefix", "BY"]);

  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");

  return root;
};

const sqliteTaskStore = (root: string) =>
  openSqliteTaskStore({
    statePath: join(root, ".but-why/state.sqlite"),
    taskPrefix: "BY",
    migrationTimestamp: () => firstNow,
  });

const sqliteRunStore = (root: string) =>
  openSqliteRunStore({
    statePath: join(root, ".but-why/state.sqlite"),
    migrationTimestamp: () => firstNow,
  });

const sqliteValidationRuns = (root: string) =>
  openSqliteValidationRuns({
    statePath: join(root, ".but-why/state.sqlite"),
    migrationTimestamp: () => firstNow,
  });
