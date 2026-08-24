import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";
import type { ChangeRecord } from "../../src/change/change.js";
import type {
  GitHubPullRequest,
  GitHubPullRequestMutationResult,
} from "../../src/change/ownedPullRequestGateway.js";
import type { TaskRecord } from "../../src/task/task.js";
import { type PublicTaskId, publicTaskId } from "../../src/task/taskId.js";
import {
  type CancellationDependencies,
  openCancellationUseCases,
} from "../../src/taskChange/cancelTaskChange.js";
import type { TaskChangeCancellationChange as CancellationChange } from "../../src/taskChange/taskChangePorts.js";
import {
  commitButWhyConfigAndRecordDefault,
  createGitRepo,
  passTaskReviewFixture,
  runByInProcessEffect,
} from "../support/by-cli.js";
import {
  noOpTerminalCleanupDependencies,
  openTerminalCleanup,
} from "../support/terminalCleanup.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const writeDefaultReviewConfig = (root: string): void => {
  writeFileSync(
    join(root, ".test-global-config.json"),
    `${JSON.stringify(
      {
        defaultAgentProfile: { scope: "global", name: "test" },
        agentProfiles: { test: { agentRuntime: "pi", runtimeConfig: { model: "test/model" } } },
      },
      null,
      2,
    )}\n`,
  );
};

describe("Change cancellation", () => {
  it.effect(
    "cancels a Change linked to a Task through Change Cancel and stores the reason on the Task",
    () =>
      Effect.gen(function* () {
        const root = createGitRepo();
        const initialized = yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"]);
        expect(initialized.status).toBe(0);
        commitButWhyConfigAndRecordDefault(root);
        writeDefaultReviewConfig(root);
        writeFileSync(join(root, "task.md"), "Implement the requested change.");

        expect(
          (yield* runByInProcessEffect(root, [
            "task",
            "create",
            "--title",
            "Linked change",
            "--file",
            "task.md",
          ])).status,
        ).toBe(0);
        yield* passTaskReviewFixture(root, "BY-1");
        const started = yield* runByInProcessEffect(root, ["change", "start", "--task", "BY-1"]);
        expect(started.status).toBe(0);
        const changeId = (
          JSON.parse(started.stdout) as { readonly change: { readonly id: string } }
        ).change.id;

        const cancelled = yield* runByInProcessEffect(root, [
          "change",
          "cancel",
          changeId,
          "--reason",
          "No longer needed",
        ]);
        expect(cancelled.status).toBe(0);
        expect(JSON.parse(cancelled.stdout)).toMatchObject({
          status: "cancelled",
          change: { state: "closed" },
          task: { state: "cancelled", cancelReason: "No longer needed" },
        });

        const repeated = yield* runByInProcessEffect(root, [
          "task",
          "cancel",
          "BY-1",
          "--reason",
          "A different reason",
        ]);
        expect(repeated.status).toBe(0);
        expect(JSON.parse(repeated.stdout)).toMatchObject({
          task: { changed: false, reason: "No longer needed" },
        });
      }),
  );

  it.effect(
    "cancels a Change linked to a Task through Task Cancel and closes its linked Change",
    () =>
      Effect.gen(function* () {
        const root = createGitRepo();
        const initialized = yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"]);
        expect(initialized.status).toBe(0);
        commitButWhyConfigAndRecordDefault(root);
        writeDefaultReviewConfig(root);
        writeFileSync(join(root, "task.md"), "Implement the requested change.");

        expect(
          (yield* runByInProcessEffect(root, [
            "task",
            "create",
            "--title",
            "Linked change",
            "--file",
            "task.md",
          ])).status,
        ).toBe(0);
        yield* passTaskReviewFixture(root, "BY-1");
        const started = yield* runByInProcessEffect(root, ["change", "start", "--task", "BY-1"]);
        expect(started.status).toBe(0);
        const changeId = (
          JSON.parse(started.stdout) as { readonly change: { readonly id: string } }
        ).change.id;

        const cancelled = yield* runByInProcessEffect(root, [
          "task",
          "cancel",
          "BY-1",
          "--reason",
          "No longer needed",
        ]);
        expect(cancelled.status).toBe(0);
        expect(JSON.parse(cancelled.stdout)).toMatchObject({
          task: { state: "cancelled", reason: "No longer needed" },
          change: { id: changeId, state: "closed" },
        });
      }),
  );

  it.effect("directly cancels an unlinked Task through Task Cancel", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const initialized = yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"]);
      expect(initialized.status).toBe(0);
      commitButWhyConfigAndRecordDefault(root);
      writeFileSync(join(root, "task.md"), "Implement the requested change.");

      expect(
        (yield* runByInProcessEffect(root, [
          "task",
          "create",
          "--title",
          "Unlinked task",
          "--file",
          "task.md",
        ])).status,
      ).toBe(0);

      const cancelled = yield* runByInProcessEffect(root, [
        "task",
        "cancel",
        "BY-1",
        "--reason",
        "No longer needed",
      ]);
      expect(cancelled.status).toBe(0);
      const output = JSON.parse(cancelled.stdout);
      expect(output).toMatchObject({ task: { state: "cancelled", reason: "No longer needed" } });
      expect(output).not.toHaveProperty("change");
    }),
  );

  it.effect("cancels a Change without a Task and exposes its reason through inspection", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const initialized = yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"]);
      expect(initialized.status).toBe(0);
      commitButWhyConfigAndRecordDefault(root);

      const started = yield* runByInProcessEffect(root, ["change", "start"]);
      expect(started.status).toBe(0);
      const changeId = (JSON.parse(started.stdout) as { readonly change: { readonly id: string } })
        .change.id;

      const cancelled = yield* runByInProcessEffect(root, [
        "change",
        "cancel",
        changeId,
        "--reason",
        "Not needed",
      ]);
      expect(cancelled.status).toBe(0);
      expect(JSON.parse(cancelled.stdout)).toMatchObject({
        status: "cancelled",
        change: { state: "closed", cancelReason: "Not needed" },
      });

      const shown = yield* runByInProcessEffect(root, ["change", "show", changeId]);
      expect(shown.status).toBe(0);
      expect(JSON.parse(shown.stdout)).toMatchObject({
        change: { state: "closed", closeReason: "cancelled", cancelReason: "Not needed" },
      });
    }),
  );

  it.effect("rejects empty cancellation reasons for Change and Task Cancel", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const initialized = yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"]);
      expect(initialized.status).toBe(0);
      commitButWhyConfigAndRecordDefault(root);
      writeFileSync(join(root, "task.md"), "Implement the requested change.");

      expect(
        (yield* runByInProcessEffect(root, [
          "task",
          "create",
          "--title",
          "Linked change",
          "--file",
          "task.md",
        ])).status,
      ).toBe(0);
      const started = yield* runByInProcessEffect(root, ["change", "start"]);
      const changeId = (JSON.parse(started.stdout) as { readonly change: { readonly id: string } })
        .change.id;

      const changeEmpty = yield* runByInProcessEffect(root, [
        "change",
        "cancel",
        changeId,
        "--reason",
        "   ",
      ]);
      expect(changeEmpty.status).toBe(2);
      expect(JSON.parse(changeEmpty.stdout).error.code).toBe("empty_reason");

      const taskEmpty = yield* runByInProcessEffect(root, [
        "task",
        "cancel",
        "BY-1",
        "--reason",
        "",
      ]);
      expect(taskEmpty.status).toBe(2);
      expect(JSON.parse(taskEmpty.stdout).error.code).toBe("empty_reason");
    }),
  );

  it.effect(
    "retries a repeated Change without a Task cancellation without changing its reason",
    () =>
      Effect.gen(function* () {
        const root = createGitRepo();
        const initialized = yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"]);
        expect(initialized.status).toBe(0);
        commitButWhyConfigAndRecordDefault(root);

        const started = yield* runByInProcessEffect(root, ["change", "start"]);
        expect(started.status).toBe(0);
        const changeId = (
          JSON.parse(started.stdout) as { readonly change: { readonly id: string } }
        ).change.id;

        const cancelled = yield* runByInProcessEffect(root, [
          "change",
          "cancel",
          changeId,
          "--reason",
          "Not needed",
        ]);
        expect(cancelled.status).toBe(0);

        const repeated = yield* runByInProcessEffect(root, [
          "change",
          "cancel",
          changeId,
          "--reason",
          "A different reason",
        ]);
        expect(repeated.status).toBe(0);
        expect(JSON.parse(repeated.stdout)).toMatchObject({
          changed: false,
          change: { cancelReason: "Not needed", cleanup: { state: "complete" } },
        });
      }),
  );

  it.effect("proves PR closure ordering through the Change CLI", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const task = taskRecord("todo");
      const dependencies = cancellationDependencies({
        task,
        change: changeRecord(null),
        pullRequest: pullRequest("open", false),
        closePullRequest: { ok: true, pullRequest: pullRequest("closed", false) },
        events,
      });
      const result = yield* runByInProcessEffect(
        createTestWorkspace(),
        ["change", "cancel", "BY-C1", "--reason", "Stop"],
        now,
        { cancellationUseCases: openCancellationUseCases(dependencies) },
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).status).toBe("cancelled");
      expect(events).toEqual(["read-pr", "close-pr", "cancel-change", "cleanup", "record-cleanup"]);
      expect(dependencies.closePullRequestInputs).toEqual([{ target, number: 42 }]);
    }),
  );

  it.effect("reports a fake GitHub closure failure through the Change CLI", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const task = taskRecord("todo");
      const dependencies = cancellationDependencies({
        task,
        change: changeRecord(null),
        pullRequest: pullRequest("open", false),
        closePullRequest: { ok: false, code: "close_failed" },
        events,
      });
      const result = yield* runByInProcessEffect(
        createTestWorkspace(),
        ["change", "cancel", "BY-C1", "--reason", "Stop"],
        now,
        { cancellationUseCases: openCancellationUseCases(dependencies) },
      );

      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: {
          code: "github_close_failed",
          message: expect.stringContaining("Change remains open"),
        },
      });
      expect(events).toEqual(["read-pr", "close-pr", "read-pr"]);
    }),
  );

  it.effect("emits bounded close and recovery diagnostics", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const task = taskRecord("todo");
      const dependencies = cancellationDependencies({
        task,
        change: changeRecord(null),
        pullRequest: pullRequest("open", false),
        closePullRequest: {
          ok: false,
          code: "close_failed",
          evidence: {
            operation: "pull_request_close",
            classification: "response_parse_failure",
          },
        },
        events,
      });
      const result = yield* runByInProcessEffect(
        createTestWorkspace(),
        ["change", "cancel", "BY-C1", "--reason", "Stop"],
        now,
        { cancellationUseCases: openCancellationUseCases(dependencies) },
      );
      expect(result.status).toBe(1);
      const output = JSON.parse(result.stdout);
      expect(output).toMatchObject({
        error: {
          evidence: { classification: "response_parse_failure" },
          recoveryEvidence: { classification: "conflict" },
        },
      });
      expect(JSON.stringify(output)).toContain("postcondition_mismatch");
      expect(result.stdout).not.toContain("raw GitHub response");
    }),
  );

  it.effect("refuses cancellation when the owned pull request is unavailable", () => {
    const events: string[] = [];
    const task = taskRecord("todo");
    const change = changeRecord(publicTaskId(task.id));
    const base = cancellationDependencies({
      task,
      change,
      pullRequest: pullRequest("open", false),
      events,
    });
    const dependencies = {
      ...base,
      github: {
        ...base.github,
        getPullRequest: () => {
          events.push("read-pr");
          throw new Error("GitHub unavailable");
        },
      },
    };

    return openCancellationUseCases(dependencies)
      .cancelTask({ taskId: publicTaskId(task.id), reason: "Stop", now })
      .pipe(
        Effect.map((result) => {
          expect(result).toEqual({
            ok: false,
            code: "github_pull_request_unavailable",
            taskId: publicTaskId(task.id),
          });
          expect(events).toEqual(["read-task", "read-change", "read-pr"]);
          return result;
        }),
      );
  });

  it.effect("refuses cancellation when the owned pull request facts mismatch", () => {
    const events: string[] = [];
    const task = taskRecord("todo");
    const change = changeRecord(publicTaskId(task.id));
    const dependencies = cancellationDependencies({
      task,
      change,
      pullRequest: { ...pullRequest("open", false), headSha: "unexpected-head" },
      events,
    });

    return openCancellationUseCases(dependencies)
      .cancelTask({ taskId: publicTaskId(task.id), reason: "Stop", now })
      .pipe(
        Effect.map((result) => {
          expect(result).toEqual({
            ok: false,
            code: "owned_pull_request_mismatch",
            taskId: publicTaskId(task.id),
          });
          expect(events).toEqual(["read-task", "read-change", "read-pr"]);
          return result;
        }),
      );
  });

  it.effect("refuses cancellation while a Validation Run is active", () => {
    const events: string[] = [];
    const task = taskRecord("todo");
    const change = changeRecord(publicTaskId(task.id));
    const dependencies = cancellationDependencies({
      task,
      change,
      pullRequest: pullRequest("closed", false),
      activeValidationRunId: 102,
      events,
    });

    return openCancellationUseCases(dependencies)
      .cancelTask({ taskId: publicTaskId(task.id), reason: "Stop", now })
      .pipe(
        Effect.map((result) => {
          expect(result).toEqual({
            ok: false,
            code: "active_validation_run",
            taskId: publicTaskId(task.id),
            validationRunId: 102,
          });
          expect(events).toEqual(["read-task", "read-change"]);
          return result;
        }),
      );
  });

  it.effect("refuses Change-selected cancellation while a Validation Run is active", () => {
    const events: string[] = [];
    const task = taskRecord("todo");
    const change = changeRecord(publicTaskId(task.id));
    const dependencies = cancellationDependencies({
      task,
      change,
      pullRequest: pullRequest("closed", false),
      activeValidationRunId: 102,
      events,
    });

    return openCancellationUseCases(dependencies)
      .cancelChange({ changeId: change.id, reason: "Stop", now })
      .pipe(
        Effect.map((result) => {
          expect(result).toEqual({
            ok: false,
            code: "active_validation_run",
            changeId: change.id,
            validationRunId: 102,
          });
          expect(events).toEqual([]);
          return result;
        }),
      );
  });

  it.effect("uses repository-local Task ID resolution before cancellation", () =>
    Effect.gen(function* () {
      const task = taskRecord("todo");
      const dependencies = cancellationDependencies({
        task,
        change: changeRecord(null),
        pullRequest: pullRequest("closed", false),
        events: [],
      });
      const result = yield* runByInProcessEffect(
        createTestWorkspace(),
        ["task", "cancel", "GH-1", "--reason", "Stop"],
        now,
        {
          cancellationUseCases: openCancellationUseCases({
            ...dependencies,
            resolveTaskId: (taskId) => ({
              ok: false,
              code: "remote_tasks_not_supported",
              taskId,
              help: "Use a repo-local Task ID such as BY-1.",
            }),
          }),
        },
      );

      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: { code: "remote_tasks_not_supported" },
        help: ["Use a repo-local Task ID such as BY-1."],
      });
    }),
  );

  it.effect("closes an owned open pull request before deleting its Remote Change Branch", () => {
    const events: string[] = [];
    const cleanupRemoteBranches: (object | null)[] = [];
    const task = taskRecord("todo");
    const change = changeRecord(publicTaskId(task.id));
    const dependencies = cancellationDependencies({
      task,
      change,
      pullRequest: pullRequest("open", false),
      closePullRequest: { ok: true, pullRequest: pullRequest("closed", false) },
      cleanupRemoteBranches,
      events,
    });

    return openCancellationUseCases(dependencies)
      .cancelTask({ taskId: publicTaskId(task.id), reason: "Stop", now })
      .pipe(
        Effect.map((result) => {
          expect(result).toMatchObject({
            ok: true,
            status: "cancelled",
            task: { state: "cancelled", cancelReason: "Stop" },
          });
          expect(events).toEqual([
            "read-task",
            "read-change",
            "read-pr",
            "close-pr",
            "cancel-change",
            "cleanup",
            "record-cleanup",
          ]);
          expect(cleanupRemoteBranches).toEqual([
            {
              owner: target.owner,
              repo: target.repo,
              remoteName: target.remoteName,
              remoteUrl: change.baseRemoteUrl,
              branchName: "change-1",
              targetBranch: target.baseBranch,
              expectedHeadSha: "head",
            },
          ]);
          return result;
        }),
      );
  });

  it.effect("accepts an exact close readback without a duplicate close mutation", () => {
    const events: string[] = [];
    const task = taskRecord("todo");
    const change = changeRecord(publicTaskId(task.id));
    const base = cancellationDependencies({
      task,
      change,
      pullRequest: pullRequest("open", false),
      closePullRequest: { ok: false, code: "close_failed" },
      events,
    });
    let reads = 0;
    const dependencies = {
      ...base,
      github: {
        ...base.github,
        getPullRequest: () => {
          events.push("read-pr");
          reads += 1;
          return {
            ok: true as const,
            pullRequest: reads === 1 ? pullRequest("open", false) : pullRequest("closed", false),
          };
        },
      },
    };

    return openCancellationUseCases(dependencies)
      .cancelTask({ taskId: publicTaskId(task.id), reason: "Stop", now })
      .pipe(
        Effect.map((result) => {
          expect(result).toMatchObject({ ok: true, status: "cancelled" });
          expect(dependencies.closePullRequestInputs).toHaveLength(1);
          expect(events).toEqual([
            "read-task",
            "read-change",
            "read-pr",
            "close-pr",
            "read-pr",
            "cancel-change",
            "cleanup",
            "record-cleanup",
          ]);
          return result;
        }),
      );
  });

  it.effect("leaves the lifecycle open and preserves close recovery evidence", () => {
    const events: string[] = [];
    const task = taskRecord("todo");
    const change = changeRecord(publicTaskId(task.id));
    const dependencies = cancellationDependencies({
      task,
      change,
      pullRequest: pullRequest("open", false),
      closePullRequest: {
        ok: false,
        code: "close_failed",
        evidence: {
          operation: "pull_request_close",
          classification: "rejected",
          exitStatus: 1,
        },
      },
      events,
    });

    return openCancellationUseCases(dependencies)
      .cancelTask({ taskId: publicTaskId(task.id), reason: "Stop", now })
      .pipe(
        Effect.map((result) => {
          expect(result).toEqual({
            ok: false,
            code: "github_close_failed",
            taskId: publicTaskId(task.id),
            evidence: {
              operation: "pull_request_close",
              classification: "rejected",
              exitStatus: 1,
            },
            recoveryEvidence: {
              operation: "remote_lookup",
              classification: "conflict",
              reason: "postcondition_mismatch",
            },
          });
          expect(events).toEqual(["read-task", "read-change", "read-pr", "close-pr", "read-pr"]);
          return result;
        }),
      );
  });

  it.effect("keeps unsafe cleanup pending without reopening the cancelled lifecycle", () => {
    const events: string[] = [];
    const task = taskRecord("todo");
    const change = changeRecord(publicTaskId(task.id));
    const dependencies = cancellationDependencies({
      task,
      change,
      pullRequest: pullRequest("closed", false),
      cleanupResult: { state: "pending", blockingReason: "worktree_has_uncommitted_changes" },
      events,
    });

    return openCancellationUseCases(dependencies)
      .cancelTask({ taskId: publicTaskId(task.id), reason: "Stop", now })
      .pipe(
        Effect.map((result) => {
          expect(result).toMatchObject({
            ok: true,
            status: "cancelled",
            change: { state: "closed" },
            cleanup: { state: "pending", blockingReason: "worktree_has_uncommitted_changes" },
          });
          return result;
        }),
      );
  });
});

const now = "2026-07-24T10:00:00.000Z";
const target = {
  owner: "acme",
  repo: "widgets",
  baseBranch: "main",
  remoteName: "origin",
} as const;

const taskRecord = (state: TaskRecord["state"]): TaskRecord => ({
  id: publicTaskId("BY-1"),
  title: "Cancel me",
  description: "Description",
  state,
  startable: false,
  blockedBy: [],
  cancelReason: state === "cancelled" ? "Stop" : null,
  prerequisites: [],
  dependents: [],
});

const changeRecord = (taskId: PublicTaskId | null): ChangeRecord & CancellationChange => ({
  id: "change-1",
  repositoryCommonDirectory: "/repo/.git",
  branchRef: "refs/heads/change-1",
  baseRef: "refs/heads/main",
  baseRemoteUrl: "https://github.com/acme/repo.git",
  taskId,
  worktreePath: "/repo/worktree",
  acceptanceContext: null,
  policy: {
    reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
    stallDetection: { enabled: false, profile: null },
    prepare: null,
    checks: [{ id: "quality", command: "true", timeoutSeconds: 30 }],
  },
  prepareFailure: null,
  implementationDecisions: [],
  activeBlocker: null,
  remoteChangeBranch: {
    owner: target.owner,
    repo: target.repo,
    remoteName: target.remoteName,
    remoteUrl: "https://github.com/acme/repo.git",
    branchName: "change-1",
    targetBranch: target.baseBranch,
    expectedHeadSha: "head",
  },
  publication: {
    candidateId: 1,
    validationRunId: 1,
    target,
    headBranch: "change-1",
    expectedHeadSha: "head",
    pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
  },
  cleanup: { state: "pending", blockingReason: null },
  state: "open",
  closeReason: null,
  cancelReason: null,
});

const pullRequest = (state: "open" | "closed", merged: boolean): GitHubPullRequest => ({
  number: 42,
  url: "https://github.com/acme/widgets/pull/42",
  repository: { owner: target.owner, repo: target.repo },
  state,
  merged,
  baseBranch: target.baseBranch,
  headBranch: "change-1",
  headSha: "head",
});

const cancellationDependencies = (input: {
  readonly task: TaskRecord;
  readonly change: ChangeRecord & CancellationChange;
  readonly pullRequest: GitHubPullRequest;
  readonly closePullRequest?: GitHubPullRequestMutationResult;
  readonly cleanupResult?:
    | { readonly state: "complete"; readonly blockingReason: null }
    | { readonly state: "pending"; readonly blockingReason: string };
  readonly cleanupRemoteBranches?: (object | null)[];
  readonly activeValidationRunId?: number;
  readonly events: string[];
}): CancellationDependencies & { readonly closePullRequestInputs: unknown[] } => {
  let currentTask = input.task;
  let currentChange = input.change;
  const closePullRequestInputs: unknown[] = [];
  const changes = {
    getChangeById: () => Effect.succeed(currentChange),
    getChangeByTaskId: () => {
      input.events.push("read-change");
      return Effect.succeed(currentChange);
    },
    completeMergedChange: () => {
      input.events.push("complete-change");
      currentChange = { ...currentChange, state: "closed", closeReason: "completed" };
      currentTask = { ...currentTask, state: "done" };
      return Effect.succeed({
        ok: true as const,
        changed: true,
        change: currentChange,
        task: currentChange.taskId === null ? null : currentTask,
      });
    },
    cancelChange: (cancelInput: { readonly changeId: string; readonly reason: string }) => {
      input.events.push("cancel-change");
      currentChange = {
        ...currentChange,
        state: "closed",
        closeReason: "cancelled",
        cancelReason:
          currentChange.taskId === null ? cancelInput.reason : currentChange.cancelReason,
      };
      currentTask = { ...currentTask, state: "cancelled", cancelReason: cancelInput.reason };
      return Effect.succeed({
        ok: true as const,
        changed: true,
        change: currentChange,
        task: currentChange.taskId === null ? null : currentTask,
      });
    },
    recordCleanup: () => {
      input.events.push("record-cleanup");
      currentChange = {
        ...currentChange,
        cleanup: input.cleanupResult ?? { state: "complete", blockingReason: null },
      };
      return Effect.succeed({
        ok: true as const,
        changed: true,
        cleanup: currentChange.cleanup,
      });
    },
  };
  return {
    resolveTaskId: (taskId) => ({ ok: true, taskId }),
    tasks: {
      getTaskById: () => {
        input.events.push("read-task");
        return Effect.succeed(currentTask);
      },
      cancelTask: () => {
        input.events.push("cancel-task");
        currentTask = { ...currentTask, state: "cancelled", cancelReason: "Stop" };
        return Effect.succeed({ ok: true as const, changed: true, task: currentTask });
      },
    },
    changes,
    validation: {
      getActiveForChange: () =>
        Effect.succeed(
          input.activeValidationRunId === undefined
            ? undefined
            : {
                validationRunId: input.activeValidationRunId,
                changeId: currentChange.id,
              },
        ),
    },
    executionLock: { withLock: ({ effect }) => effect },
    github: {
      getPullRequest: () => {
        input.events.push("read-pr");
        return { ok: true, pullRequest: input.pullRequest };
      },
      closePullRequest: (closeInput) => {
        input.events.push("close-pr");
        closePullRequestInputs.push(closeInput);
        return input.closePullRequest ?? { ok: true, pullRequest: pullRequest("closed", false) };
      },
    },
    cleanupTerminal: openTerminalCleanup({
      ...noOpTerminalCleanupDependencies,
      persistence: changes,
      cleanup: (cleanupInput) => {
        input.events.push("cleanup");
        input.cleanupRemoteBranches?.push(cleanupInput.remoteChangeBranch);
        return input.cleanupResult ?? { state: "complete", blockingReason: null };
      },
    }),
    closePullRequestInputs,
  };
};
