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
  startingCommit: "1111111111111111111111111111111111111111",
  worktreePath: "/repo-worktrees/but-why/by-197-change-1",
  acceptanceContext: {
    version: 1,
    title: "Accepted title",
    description: "Accepted description",
  },
  reviewerConfiguration: null,
  prepare: { command: "prepare repository", timeoutSeconds: 17 },
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
        startingCommit: "1111111111111111111111111111111111111111",
        worktreePath: "/repo-worktrees/but-why/by-197-change-1",
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

  it("keeps Task ID out of linked Change Prepare recovery errors", () => {
    const prepared = prepareResult({
      ok: false,
      code: "managed_branch_missing",
      branch: change().branchRef,
      path: change().worktreePath,
      startingCommit: change().startingCommit,
      change: change(),
    });
    expect(prepared).toMatchObject({
      exitCode: 1,
      stdout: {
        help: [
          expect.stringContaining("by change prepare change-1"),
          expect.stringContaining("by change cancel change-1"),
        ],
      },
    });
    expect(JSON.stringify(prepared.stdout)).not.toContain("BY-197");
  });
});
