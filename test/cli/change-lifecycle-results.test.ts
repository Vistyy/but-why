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
  taskId: "BY-197" as PublicTaskId,
  acceptanceContext: {
    version: 1,
    title: "Accepted title",
    description: "Accepted description",
  },
  prepare: { command: "prepare repository", timeoutSeconds: 17 },
  prepareFailure,
  publication: null,
  cleanup: { state: "pending", blockingReason: null },
  state: "open",
  closeReason: null,
  cancelReason: null,
  createdAt: "2026-07-17T22:50:00.000Z",
  updatedAt: "2026-07-17T22:50:00.000Z",
  closedAt: null,
});

describe("Change lifecycle CLI results", () => {
  it("renders successful Task-backed Change Start identity", () => {
    expect(startResult({ ok: true, change: change() })).toEqual({
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
      stdout: { change: { id: "change-1", taskId: "BY-197" }, prepareFailure: failure },
    });
    expect(prepareResult({ ok: true, change: change() }).stdout).not.toHaveProperty(
      "prepareFailure",
    );
  });
});
