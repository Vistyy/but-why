import { Effect } from "effect";

import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type { TaskRecord } from "../task/task.js";
import type { PublicTaskId } from "../task/taskId.js";
import type { RepoTaskIdResolution } from "../task/repoTaskIds.js";
import type { ChangeCleanup, ChangeRecord } from "./change.js";
import type { ChangePersistence } from "./changePersistence.js";
import type { TaskPersistence } from "../task/taskPersistence.js";
import type { GitHubPullRequestGateway } from "./ownedPullRequestGateway.js";
import { observeOwnedPullRequest } from "./ownedPullRequestClassifier.js";
import type { ExecutionLock } from "../contracts/executionLock.js";
import type { ChangeValidationPersistence } from "./validation/changeValidationPersistence.js";
import type { TerminalCleanupOperation } from "./cleanupTerminalChange.js";

export type CancellationUseCases = {
  readonly resolveTaskId: (taskId: PublicTaskId) => RepoTaskIdResolution;
  readonly cancelTask: (input: {
    readonly taskId: PublicTaskId;
    readonly reason: string;
    readonly now: string;
  }) => Effect.Effect<TaskCancellationResult, RepositoryStorageError>;
  readonly cancelChange: (input: {
    readonly changeId: string;
    readonly now: string;
  }) => Effect.Effect<ChangeCancellationResult, RepositoryStorageError>;
};

export type CancellationDependencies = {
  readonly resolveTaskId: (taskId: PublicTaskId) => RepoTaskIdResolution;
  readonly tasks: Pick<TaskPersistence, "getTaskById" | "cancelTask">;
  readonly changes: Pick<
    ChangePersistence,
    "getChangeById" | "getChangeByTaskId" | "completeMergedChange" | "cancelChange"
  >;
  readonly github: Pick<GitHubPullRequestGateway, "getPullRequest" | "closePullRequest">;
  readonly validation?: Pick<ChangeValidationPersistence, "getActiveForChange">;
  readonly executionLock?: ExecutionLock;
  readonly cleanupTerminal: TerminalCleanupOperation;
};

export type TaskCancellationResult =
  | {
      readonly ok: true;
      readonly status: "cancelled" | "completed";
      readonly changed: boolean;
      readonly task: TaskRecord;
      readonly change: ChangeRecord | null;
      readonly cleanup: ChangeCleanup | null;
    }
  | {
      readonly ok: false;
      readonly code:
        | "task_not_found"
        | "change_not_found"
        | "task_already_done"
        | "change_already_completed"
        | "github_pull_request_unavailable"
        | "owned_pull_request_mismatch"
        | "github_close_failed"
        | "submission_in_progress"
        | "active_validation_run";
      readonly taskId: PublicTaskId;
      readonly validationRunId?: string;
    };

export type ChangeCancellationResult =
  | {
      readonly ok: true;
      readonly status: "cancelled" | "completed";
      readonly changed: boolean;
      readonly change: ChangeRecord;
      readonly task: TaskRecord | null;
    }
  | {
      readonly ok: false;
      readonly code:
        | "change_not_found"
        | "change_already_completed"
        | "task_backed_change"
        | "github_pull_request_unavailable"
        | "owned_pull_request_mismatch"
        | "github_close_failed"
        | "submission_in_progress"
        | "active_validation_run";
      readonly changeId: string;
      readonly validationRunId?: string;
      readonly taskId?: PublicTaskId;
    };

export const openCancellationUseCases = (
  dependencies: CancellationDependencies,
): CancellationUseCases => ({
  resolveTaskId: dependencies.resolveTaskId,
  cancelTask: (input) => cancelTaskWithLock(dependencies, input),
  cancelChange: (input) => cancelChangeWithLock(dependencies, input),
});

const cancelTaskWithLock = (
  dependencies: CancellationDependencies,
  input: Parameters<CancellationUseCases["cancelTask"]>[0],
): Effect.Effect<TaskCancellationResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    if (dependencies.executionLock === undefined) {
      return yield* cancelTask(dependencies, input);
    }
    const change = yield* dependencies.changes.getChangeByTaskId(input.taskId);
    if (change === undefined) {
      return yield* cancelTask(dependencies, input);
    }
    return yield* dependencies.executionLock
      .withLock({
        owner: "change_submission",
        key: change.id,
        effect: cancelTask(dependencies, input),
      })
      .pipe(
        Effect.catchTag("ExecutionLockUnavailable", () =>
          Effect.succeed({
            ok: false,
            code: "submission_in_progress",
            taskId: input.taskId,
          } as const),
        ),
      );
  });

const cancelChangeWithLock = (
  dependencies: CancellationDependencies,
  input: Parameters<CancellationUseCases["cancelChange"]>[0],
): Effect.Effect<ChangeCancellationResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    if (dependencies.executionLock === undefined) {
      return yield* cancelChange(dependencies, input);
    }
    const change = yield* dependencies.changes.getChangeById(input.changeId);
    if (change === undefined) {
      return yield* cancelChange(dependencies, input);
    }
    return yield* dependencies.executionLock
      .withLock({
        owner: "change_submission",
        key: change.id,
        effect: cancelChange(dependencies, input),
      })
      .pipe(
        Effect.catchTag("ExecutionLockUnavailable", () =>
          Effect.succeed({
            ok: false,
            code: "submission_in_progress",
            changeId: input.changeId,
          } as const),
        ),
      );
  });

const cancelTask = (
  dependencies: CancellationDependencies,
  input: Parameters<CancellationUseCases["cancelTask"]>[0],
): Effect.Effect<TaskCancellationResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const task = yield* dependencies.tasks.getTaskById(input.taskId);
    if (task === undefined) return { ok: false, code: "task_not_found", taskId: input.taskId };
    if (task.state === "done")
      return { ok: false, code: "task_already_done", taskId: input.taskId };
    if (task.state === "cancelled") {
      const existingChange = yield* dependencies.changes.getChangeByTaskId(input.taskId);
      if (existingChange === undefined) {
        return {
          ok: true,
          status: "cancelled",
          changed: false,
          task,
          change: null,
          cleanup: null,
        };
      }
      const withCleanup = yield* cleanupTerminalChange(dependencies, existingChange, input.now);
      return {
        ok: true,
        status: "cancelled" as const,
        changed: false,
        task,
        change: withCleanup.change,
        cleanup: withCleanup.cleanup,
      };
    }

    const change = yield* dependencies.changes.getChangeByTaskId(input.taskId);
    if (change === undefined) {
      const cancelled = yield* dependencies.tasks.cancelTask(input);
      return cancelled.ok
        ? {
            ok: true,
            status: "cancelled" as const,
            changed: cancelled.changed,
            task: cancelled.task,
            change: null,
            cleanup: null,
          }
        : { ok: false, code: cancelled.code, taskId: input.taskId };
    }
    const active = yield* dependencies.validation?.getActiveForChange(change.id) ??
      Effect.succeed(undefined);
    if (active !== undefined) {
      return {
        ok: false,
        code: "active_validation_run",
        taskId: input.taskId,
        validationRunId: active.validationRunId,
      } as const;
    }
    if (change.state === "closed") {
      if (change.closeReason === "completed") {
        return { ok: false, code: "change_already_completed", taskId: input.taskId };
      }
      const cancelled = yield* dependencies.tasks.cancelTask(input);
      if (!cancelled.ok) return { ok: false, code: cancelled.code, taskId: input.taskId };
      const withCleanup = yield* cleanupTerminalChange(dependencies, change, input.now);
      return {
        ok: true,
        status: "cancelled" as const,
        changed: cancelled.changed,
        task: cancelled.task,
        change: withCleanup.change,
        cleanup: withCleanup.cleanup,
      };
    }

    const remote = observeOwnedPullRequest(dependencies.github, change);
    switch (remote.kind) {
      case "unavailable":
        return { ok: false, code: "github_pull_request_unavailable", taskId: input.taskId };
      case "mismatch":
        return { ok: false, code: "owned_pull_request_mismatch", taskId: input.taskId };
      case "exact_merged":
        return yield* completeMerged(dependencies, change, input.now);
      case "exact_open": {
        const closed = closeOwnedPullRequest(dependencies, change);
        if (!closed.ok) return { ...closed, taskId: input.taskId };
        if (closed.status === "merged") {
          return yield* completeMerged(dependencies, change, input.now);
        }
        break;
      }
      case "not_owned":
      case "exact_closed_unmerged":
        break;
    }

    const cancelled = yield* dependencies.changes.cancelChange({
      changeId: change.id,
      reason: input.reason,
      now: input.now,
    });
    if (!cancelled.ok) return { ...cancelled, taskId: input.taskId };
    const withCleanup = yield* cleanupTerminalChange(dependencies, cancelled.change, input.now);
    const finalTask = yield* dependencies.tasks.getTaskById(input.taskId);
    if (finalTask === undefined) return { ok: false, code: "task_not_found", taskId: input.taskId };
    return {
      ok: true,
      status: "cancelled" as const,
      changed: cancelled.changed,
      task: finalTask,
      change: withCleanup.change,
      cleanup: withCleanup.cleanup,
    };
  });

const cancelChange = (
  dependencies: CancellationDependencies,
  input: Parameters<CancellationUseCases["cancelChange"]>[0],
): Effect.Effect<ChangeCancellationResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const change = yield* dependencies.changes.getChangeById(input.changeId);
    if (change === undefined)
      return { ok: false, code: "change_not_found", changeId: input.changeId };
    if (change.taskId !== null) {
      return {
        ok: false,
        code: "task_backed_change",
        changeId: change.id,
        taskId: change.taskId,
      };
    }
    const active = yield* dependencies.validation?.getActiveForChange(change.id) ??
      Effect.succeed(undefined);
    if (active !== undefined) {
      return {
        ok: false,
        code: "active_validation_run",
        changeId: change.id,
        validationRunId: active.validationRunId,
      } as const;
    }
    if (change.state === "closed") {
      if (change.closeReason !== "cancelled") {
        return { ok: false, code: "change_already_completed" as const, changeId: change.id };
      }
      const withCleanup = yield* cleanupTerminalChange(dependencies, change, input.now);
      return {
        ok: true,
        status: "cancelled" as const,
        changed: false,
        change: withCleanup.change,
        task: null,
      };
    }

    const remote = observeOwnedPullRequest(dependencies.github, change);
    switch (remote.kind) {
      case "unavailable":
        return { ok: false, code: "github_pull_request_unavailable", changeId: change.id };
      case "mismatch":
        return { ok: false, code: "owned_pull_request_mismatch", changeId: change.id };
      case "exact_merged":
        return yield* completeMergedChange(dependencies, change, input.now);
      case "exact_open": {
        const closed = closeOwnedPullRequest(dependencies, change);
        if (!closed.ok) return { ...closed, changeId: change.id };
        if (closed.status === "merged") {
          return yield* completeMergedChange(dependencies, change, input.now);
        }
        break;
      }
      case "not_owned":
      case "exact_closed_unmerged":
        break;
    }

    const cancelled = yield* dependencies.changes.cancelChange({
      changeId: change.id,
      reason: "Taskless Change cancelled",
      now: input.now,
    });
    if (!cancelled.ok) return { ...cancelled, changeId: change.id };
    const withCleanup = yield* cleanupTerminalChange(dependencies, cancelled.change, input.now);
    return {
      ok: true,
      status: "cancelled" as const,
      changed: cancelled.changed,
      change: withCleanup.change,
      task: null,
    };
  });

const completeMerged = (
  dependencies: CancellationDependencies,
  change: ChangeRecord,
  now: string,
): Effect.Effect<TaskCancellationResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    if (change.taskId === null)
      return yield* Effect.die(new Error("Merged Task Change lacks a Task"));
    const taskId = change.taskId;
    const completed = yield* dependencies.changes.completeMergedChange({
      changeId: change.id,
      now,
    });
    if (!completed.ok) return { ok: false, code: "change_already_completed", taskId };
    const withCleanup = yield* cleanupTerminalChange(dependencies, completed.change, now);
    const task = yield* dependencies.tasks.getTaskById(taskId);
    if (task === undefined) return { ok: false, code: "task_not_found", taskId };
    return {
      ok: true,
      status: "completed" as const,
      changed: completed.changed,
      task,
      change: withCleanup.change,
      cleanup: withCleanup.cleanup,
    };
  });

const completeMergedChange = (
  dependencies: CancellationDependencies,
  change: ChangeRecord,
  now: string,
): Effect.Effect<ChangeCancellationResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const completed = yield* dependencies.changes.completeMergedChange({
      changeId: change.id,
      now,
    });
    if (!completed.ok) return { ok: false, code: "change_already_completed", changeId: change.id };
    const withCleanup = yield* cleanupTerminalChange(dependencies, completed.change, now);
    return {
      ok: true,
      status: "completed" as const,
      changed: completed.changed,
      change: withCleanup.change,
      task: null,
    };
  });

const closeOwnedPullRequest = (
  dependencies: CancellationDependencies,
  change: ChangeRecord,
):
  | { readonly ok: true; readonly status: "closed" | "merged" }
  | { readonly ok: false; readonly code: "github_close_failed" } => {
  const publication = change.publication;
  if (publication === null || publication.pullRequest === null)
    return { ok: true, status: "closed" };
  try {
    if (dependencies.github.closePullRequest === undefined) {
      return { ok: false, code: "github_close_failed" };
    }
    const result = dependencies.github.closePullRequest({
      target: publication.target,
      number: publication.pullRequest.number,
    });
    if (!result.ok) return { ok: false, code: "github_close_failed" };
    return result.pullRequest.merged === true
      ? { ok: true, status: "merged" }
      : result.pullRequest.state === "closed"
        ? { ok: true, status: "closed" }
        : { ok: false, code: "github_close_failed" };
  } catch {
    return { ok: false, code: "github_close_failed" };
  }
};

const cleanupTerminalChange = (
  dependencies: CancellationDependencies,
  change: ChangeRecord,
  now: string,
): Effect.Effect<
  { readonly change: ChangeRecord; readonly cleanup: ChangeCleanup },
  RepositoryStorageError
> =>
  Effect.map(dependencies.cleanupTerminal(change, now), (result) =>
    result.ok
      ? { change: result.change, cleanup: result.cleanup }
      : { change, cleanup: change.cleanup },
  );
