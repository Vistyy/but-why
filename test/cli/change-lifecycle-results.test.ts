import { expect, it } from "@effect/vitest";
import { describe } from "vitest";

import type { ChangeStartRecord } from "../../src/change/changeStartStore.js";
import { prepareResult, startResult } from "../../src/cli/change/lifecycleResults.js";
import type { PublicTaskId } from "../../src/task/taskId.js";

const change = (prepareFailure: ChangeStartRecord["prepareFailure"] = null): ChangeStartRecord => ({
  id: "change-1",
  repositoryCommonDirectory: "/repo/.git",
  branchRef: "refs/heads/but-why/by-197-change-1",
  baseRef: "refs/remotes/origin/main",
  baseRemoteUrl: "https://github.com/acme/repo.git",
  worktreePath: "/repo-worktrees/but-why/by-197-change-1",
  acceptanceContext: {
    version: 1,
    title: "Accepted title",
    description: "Accepted description",
  },
  policy: {
    reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
    prepare: { command: "prepare repository", timeoutSeconds: 17 },
    checks: [],
  },
  prepareFailure,
  state: "open",
});

describe("Change lifecycle CLI results", () => {
  it("renders successful Change Start identity for a Change linked to a Task", () => {
    expect(startResult({ ok: true, change: change(), taskId: "BY-197" })).toEqual({
      exitCode: 0,
      stdout: {
        change: { id: "change-1", taskId: "BY-197" },
        branch: "refs/heads/but-why/by-197-change-1",
        baseRef: "refs/remotes/origin/main",
        worktreePath: "/repo-worktrees/but-why/by-197-change-1",
      },
    });
  });

  it("renders successful Change Start identity without a Task ID", () => {
    expect(startResult({ ok: true, change: change() })).toEqual({
      exitCode: 0,
      stdout: {
        change: { id: "change-1", taskId: null },
        branch: "refs/heads/but-why/by-197-change-1",
        baseRef: "refs/remotes/origin/main",
        worktreePath: "/repo-worktrees/but-why/by-197-change-1",
      },
    });
  });

  it("identifies complete Change Policy resolution failures", () => {
    expect(
      startResult({
        ok: false,
        code: "change_policy_invalid",
        message: "Validation Checks are missing.",
      }),
    ).toEqual({
      exitCode: 1,
      stdout: {
        error: {
          code: "change_policy_invalid",
          message: "Validation Checks are missing.",
        },
        help: ["Fix the complete Change Policy inputs, then run Change Start again."],
      },
    });
  });

  it("renders incomplete Task prerequisites", () => {
    expect(
      startResult({
        ok: false,
        code: "task_dependencies_unsatisfied",
        blockedBy: [{ id: "BY-196" as PublicTaskId, title: "Prerequisite", state: "todo" }],
      }),
    ).toEqual({
      exitCode: 1,
      stdout: {
        error: {
          code: "task_dependencies_unsatisfied",
          message: "The Task has incomplete prerequisites.",
          blockedBy: [{ id: "BY-196", title: "Prerequisite", state: "todo" }],
        },
        help: ["Complete every prerequisite, then run Change Start again."],
      },
    });
  });

  it("renders requested Change Base conflicts", () => {
    expect(
      startResult({
        ok: false,
        code: "requested_base_conflict",
        requestedBaseBranch: "release",
        recordedBaseBranch: "main",
      }),
    ).toMatchObject({
      exitCode: 1,
      stdout: {
        error: {
          code: "requested_base_conflict",
          requestedBaseBranch: "release",
          recordedBaseBranch: "main",
        },
      },
    });
  });

  it("renders and clears Repository Preparation failure from Change Prepare", () => {
    const failure = {
      command: "prepare repository",
      exitCode: 7,
      timedOut: false,
      stdout: "partial",
      stderr: "failed",
    };
    expect(prepareResult({ ok: true, change: change(failure) })).toMatchObject({
      exitCode: 0,
      stdout: { change: { id: "change-1" }, prepareFailure: failure },
    });
    expect(prepareResult({ ok: true, change: change(failure) }).stdout).not.toHaveProperty(
      "change.taskId",
    );
    expect(prepareResult({ ok: true, change: change() }).stdout).not.toHaveProperty(
      "prepareFailure",
    );
  });
});
