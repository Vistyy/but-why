import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";
import {
  type CancellationDependencies,
  openCancellationUseCases,
} from "../../src/change/cancelChange.js";
import type { ChangeRecord } from "../../src/change/change.js";
import { openTerminalCleanup } from "../../src/change/cleanupTerminalChange.js";
import type { GitHubPullRequest } from "../../src/change/ownedPullRequestGateway.js";
import type { TaskRecord } from "../../src/task/task.js";
import { type PublicTaskId, publicTaskId } from "../../src/task/taskId.js";
import {
  commitButWhyConfigAndRecordDefault,
  createGitRepo,
  runByInProcessEffect,
} from "../support/by-cli.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

describe("Change cancellation", () => {
  it.effect(
    "cancels a Task-backed Change through Change Cancel and stores the reason on the Task",
    () =>
      Effect.gen(function* () {
        const root = createGitRepo();
        const initialized = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);
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
        expect((yield* runByInProcessEffect(root, ["task", "approve", "BY-1"])).status).toBe(0);
        const started = yield* runByInProcessEffect(root, [
          "--json",
          "change",
          "start",
          "--task",
          "BY-1",
        ]);
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
        expect(cancelled.stdout).toContain("status: cancelled");
        expect(cancelled.stdout).toContain("state: closed");
        expect(cancelled.stdout).toContain("state: cancelled");
        expect(cancelled.stdout).toContain("cancelReason: No longer needed");

        const repeated = yield* runByInProcessEffect(root, [
          "task",
          "cancel",
          "BY-1",
          "--reason",
          "A different reason",
        ]);
        expect(repeated.status).toBe(0);
        expect(repeated.stdout).toContain("changed: false");
        expect(repeated.stdout).toContain("reason: No longer needed");
      }),
  );

  it.effect("cancels a Task-backed Change through Task Cancel and closes its linked Change", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const initialized = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);
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
      expect((yield* runByInProcessEffect(root, ["task", "approve", "BY-1"])).status).toBe(0);
      const started = yield* runByInProcessEffect(root, [
        "--json",
        "change",
        "start",
        "--task",
        "BY-1",
      ]);
      expect(started.status).toBe(0);
      const changeId = (JSON.parse(started.stdout) as { readonly change: { readonly id: string } })
        .change.id;

      const cancelled = yield* runByInProcessEffect(root, [
        "task",
        "cancel",
        "BY-1",
        "--reason",
        "No longer needed",
      ]);
      expect(cancelled.status).toBe(0);
      expect(cancelled.stdout).toContain("state: cancelled");
      expect(cancelled.stdout).toContain("reason: No longer needed");
      expect(cancelled.stdout).toContain("state: closed");
      expect(cancelled.stdout).toContain(`id: ${changeId}`);
    }),
  );

  it.effect("directly cancels an unlinked Task through Task Cancel", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const initialized = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);
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
      expect(cancelled.stdout).toContain("state: cancelled");
      expect(cancelled.stdout).toContain("reason: No longer needed");
      expect(cancelled.stdout).not.toContain("change:");
    }),
  );

  it.effect("cancels a Taskless Change and exposes its reason through inspection", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const initialized = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);
      expect(initialized.status).toBe(0);
      commitButWhyConfigAndRecordDefault(root);

      const started = yield* runByInProcessEffect(root, ["--json", "change", "start"]);
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
      expect(cancelled.stdout).toContain("status: cancelled");
      expect(cancelled.stdout).toContain("state: closed");
      expect(cancelled.stdout).toContain("cancelReason: Not needed");

      const shown = yield* runByInProcessEffect(root, ["change", "show", changeId]);
      expect(shown.status).toBe(0);
      expect(shown.stdout).toContain("state: closed");
      expect(shown.stdout).toContain("closeReason: cancelled");
      expect(shown.stdout).toContain("cancelReason: Not needed");
    }),
  );

  it.effect("rejects empty cancellation reasons for Change and Task Cancel", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const initialized = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);
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
      const started = yield* runByInProcessEffect(root, ["--json", "change", "start"]);
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
      expect(changeEmpty.stdout).toContain("code: empty_reason");

      const taskEmpty = yield* runByInProcessEffect(root, [
        "task",
        "cancel",
        "BY-1",
        "--reason",
        "",
      ]);
      expect(taskEmpty.status).toBe(2);
      expect(taskEmpty.stdout).toContain("code: empty_reason");
    }),
  );

  it.effect("retries a repeated Taskless Change cancellation without changing its reason", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const initialized = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);
      expect(initialized.status).toBe(0);
      commitButWhyConfigAndRecordDefault(root);

      const started = yield* runByInProcessEffect(root, ["--json", "change", "start"]);
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

      const repeated = yield* runByInProcessEffect(root, [
        "change",
        "cancel",
        changeId,
        "--reason",
        "A different reason",
      ]);
      expect(repeated.status).toBe(0);
      expect(repeated.stdout).toContain("changed: false");
      expect(repeated.stdout).toContain("cancelReason: Not needed");
      expect(repeated.stdout).toContain("state: complete");
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
        ["change", "cancel", "change-1", "--reason", "Stop"],
        now,
        { cancellationUseCases: openCancellationUseCases(dependencies) },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("status: cancelled");
      expect(events).toEqual([
        "read-pr",
        "close-pr",
        "cancel-change",
        "cleanup",
        "record-cleanup",
        "remove-reviewer-sessions",
      ]);
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
        ["change", "cancel", "change-1", "--reason", "Stop"],
        now,
        { cancellationUseCases: openCancellationUseCases(dependencies) },
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("code: github_close_failed");
      expect(result.stdout).toContain("Change remains open");
      expect(events).toEqual(["read-pr", "close-pr"]);
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
      activeValidationRunId: "run-active",
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
            validationRunId: "run-active",
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
      activeValidationRunId: "run-active",
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
            validationRunId: "run-active",
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
      expect(result.stdout).toContain("code: remote_tasks_not_supported");
      expect(result.stdout).toContain("Use a repo-local Task ID such as BY-1.");
    }),
  );

  it.effect("reports merged observation through the Task CLI", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const task = taskRecord("todo");
      const dependencies = cancellationDependencies({
        task,
        change: changeRecord(publicTaskId(task.id)),
        pullRequest: pullRequest("closed", true),
        events,
      });
      const result = yield* runByInProcessEffect(
        createTestWorkspace(),
        ["task", "cancel", "BY-1", "--reason", "Stop"],
        now,
        { cancellationUseCases: openCancellationUseCases(dependencies) },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("status: completed");
      expect(result.stdout).toContain("state: done");
      expect(events).toEqual([
        "read-task",
        "read-change",
        "read-pr",
        "complete-change",
        "cleanup",
        "record-cleanup",
        "remove-reviewer-sessions",
        "read-task",
      ]);
    }),
  );

  it.effect("reports stale merged publication as an owned pull request mismatch", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const task = taskRecord("todo");
      const dependencies = cancellationDependencies({
        task,
        change: changeRecord(publicTaskId(task.id)),
        pullRequest: pullRequest("closed", true),
        completeMergedFailure: "publication_mismatch",
        events,
      });
      const result = yield* runByInProcessEffect(
        createTestWorkspace(),
        ["task", "cancel", "BY-1", "--reason", "Stop"],
        now,
        { cancellationUseCases: openCancellationUseCases(dependencies) },
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("code: owned_pull_request_mismatch");
      expect(events).toEqual(["read-task", "read-change", "read-pr", "complete-change"]);
    }),
  );

  it.effect("closes an owned open pull request before deleting its Remote Change Branch", () => {
    const events: string[] = [];
    const cleanupRemoteBranches: (object | undefined)[] = [];
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
          expect(result).toMatchObject({ ok: true, status: "cancelled" });
          expect(events).toEqual([
            "read-task",
            "read-change",
            "read-pr",
            "close-pr",
            "cancel-change",
            "cleanup",
            "record-cleanup",
            "remove-reviewer-sessions",
            "read-task",
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

  it.effect("leaves the lifecycle open when owned pull request closure fails", () => {
    const events: string[] = [];
    const task = taskRecord("todo");
    const change = changeRecord(publicTaskId(task.id));
    const dependencies = cancellationDependencies({
      task,
      change,
      pullRequest: pullRequest("open", false),
      closePullRequest: { ok: false, code: "close_failed" },
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
          });
          expect(events).toEqual(["read-task", "read-change", "read-pr", "close-pr"]);
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
  createdAt: now,
  updatedAt: now,
  startable: false,
  blockedBy: [],
  cancelReason: state === "cancelled" ? "Stop" : null,
  prerequisites: [],
  dependents: [],
});

const changeRecord = (taskId: PublicTaskId | null): ChangeRecord => ({
  id: "change-1",
  repositoryCommonDirectory: "/repo/.git",
  branchRef: "refs/heads/change-1",
  baseRef: "refs/heads/main",
  baseRemoteUrl: "https://github.com/acme/repo.git",
  taskId,
  startingCommit: "base",
  worktreePath: null,
  acceptanceContext: null,
  prepare: null,
  prepareFailure: null,
  publication: {
    candidateId: "candidate-1",
    validationRunId: "run-1",
    target,
    headBranch: "change-1",
    expectedHeadSha: "head",
    pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
  },
  cleanup: { state: "pending", blockingReason: null },
  state: "open",
  closeReason: null,
  cancelReason: null,
  createdAt: now,
  updatedAt: now,
  closedAt: null,
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
  readonly change: ChangeRecord;
  readonly pullRequest: GitHubPullRequest;
  readonly closePullRequest?:
    | { readonly ok: true; readonly pullRequest: GitHubPullRequest }
    | { readonly ok: false; readonly code: "close_failed" };
  readonly cleanupResult?:
    | { readonly state: "complete"; readonly blockingReason: null }
    | { readonly state: "pending"; readonly blockingReason: string };
  readonly cleanupRemoteBranches?: (object | undefined)[];
  readonly completeMergedFailure?: "change_already_closed" | "publication_mismatch";
  readonly activeValidationRunId?: string;
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
      if (input.completeMergedFailure !== undefined) {
        return Effect.succeed({
          ok: false as const,
          code: input.completeMergedFailure,
        });
      }
      currentChange = { ...currentChange, state: "closed", closeReason: "completed" };
      currentTask = { ...currentTask, state: "done" };
      return Effect.succeed({ ok: true as const, changed: true, change: currentChange });
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
      return Effect.succeed({ ok: true as const, changed: true, change: currentChange });
    },
    recordCleanup: () => {
      input.events.push("record-cleanup");
      currentChange = {
        ...currentChange,
        cleanup: input.cleanupResult ?? { state: "complete", blockingReason: null },
      };
      return Effect.succeed({ ok: true as const, changed: true, change: currentChange });
    },
    removeReviewerSessions: () => {
      input.events.push("remove-reviewer-sessions");
      return Effect.void;
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
    ...(input.activeValidationRunId === undefined
      ? {}
      : {
          validation: {
            getActiveForChange: () =>
              Effect.succeed({
                validationRunId: input.activeValidationRunId ?? "",
                changeId: currentChange.id,
              }),
          },
        }),
    github: {
      getPullRequest: () => {
        input.events.push("read-pr");
        return input.pullRequest;
      },
      closePullRequest: (closeInput) => {
        input.events.push("close-pr");
        closePullRequestInputs.push(closeInput);
        return input.closePullRequest ?? { ok: true, pullRequest: pullRequest("closed", false) };
      },
    },
    cleanupTerminal: openTerminalCleanup({
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
