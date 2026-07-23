import { Effect } from "effect";

import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type { TaskRecord } from "../task/task.js";
import type { PublicTaskId } from "../task/taskId.js";
import type { RepoTaskIdResolution } from "../task/repoTaskIds.js";
import type { ChangeCleanup, ChangeRecord } from "./change.js";
import type { ChangePersistence } from "./changePersistence.js";
import type { ChangeCleanupOperationResult } from "./reconcileChange.js";
import type { TaskPersistence } from "../task/taskPersistence.js";
import type { GitHubPullRequest, GitHubPullRequestGateway } from "./ownedPullRequestGateway.js";

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
    | "getChangeById"
    | "getChangeByTaskId"
    | "completeMergedChange"
    | "cancelChange"
    | "recordCleanup"
  >;
  readonly github: Pick<GitHubPullRequestGateway, "getPullRequest" | "closePullRequest">;
  readonly cleanup: (input: {
    readonly repositoryCommonDirectory: string;
    readonly worktreePath: string | null;
    readonly branchRef: string;
  }) => ChangeCleanupOperationResult;
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
        | "github_close_failed";
      readonly taskId: PublicTaskId;
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
        | "github_close_failed";
      readonly changeId: string;
      readonly taskId?: PublicTaskId;
    };

export const openCancellationUseCases = (
  dependencies: CancellationDependencies,
): CancellationUseCases => ({
  resolveTaskId: dependencies.resolveTaskId,
  cancelTask: (input) => cancelTask(dependencies, input),
  cancelChange: (input) => cancelChange(dependencies, input),
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
      return {
        ok: true,
        status: "cancelled",
        changed: false,
        task,
        change: existingChange ?? null,
        cleanup: existingChange?.cleanup ?? null,
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
    if (change.state === "closed") {
      if (change.closeReason === "completed") {
        return { ok: false, code: "change_already_completed", taskId: input.taskId };
      }
      const cancelled = yield* dependencies.tasks.cancelTask(input);
      return cancelled.ok
        ? {
            ok: true,
            status: "cancelled" as const,
            changed: cancelled.changed,
            task: cancelled.task,
            change,
            cleanup: change.cleanup,
          }
        : { ok: false, code: cancelled.code, taskId: input.taskId };
    }

    const remote = observeOwnedPullRequest(dependencies, change);
    if (!remote.ok) return { ...remote, taskId: input.taskId };
    if (remote.status === "merged") {
      return yield* completeMerged(dependencies, change, input.now);
    }
    if (remote.status === "open") {
      const closed = closeOwnedPullRequest(dependencies, change);
      if (!closed.ok) return { ...closed, taskId: input.taskId };
      if (closed.status === "merged") {
        return yield* completeMerged(dependencies, change, input.now);
      }
    }

    const cancelled = yield* dependencies.changes.cancelChange({
      changeId: change.id,
      reason: input.reason,
      now: input.now,
    });
    if (!cancelled.ok) return { ...cancelled, taskId: input.taskId };
    const withCleanup = yield* cleanupClosedChange(dependencies, cancelled.change, input.now);
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
    if (change.state === "closed") {
      return change.closeReason === "cancelled"
        ? { ok: true, status: "cancelled" as const, changed: false, change, task: null }
        : { ok: false, code: "change_already_completed" as const, changeId: change.id };
    }

    const remote = observeOwnedPullRequest(dependencies, change);
    if (!remote.ok) return { ...remote, changeId: change.id };
    if (remote.status === "merged") {
      return yield* completeMergedChange(dependencies, change, input.now);
    }
    if (remote.status === "open") {
      const closed = closeOwnedPullRequest(dependencies, change);
      if (!closed.ok) return { ...closed, changeId: change.id };
      if (closed.status === "merged") {
        return yield* completeMergedChange(dependencies, change, input.now);
      }
    }

    const cancelled = yield* dependencies.changes.cancelChange({
      changeId: change.id,
      reason: "Taskless Change cancelled",
      now: input.now,
    });
    if (!cancelled.ok) return { ...cancelled, changeId: change.id };
    const withCleanup = yield* cleanupClosedChange(dependencies, cancelled.change, input.now);
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
    const withCleanup = yield* cleanupClosedChange(dependencies, completed.change, now);
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
    const withCleanup = yield* cleanupClosedChange(dependencies, completed.change, now);
    return {
      ok: true,
      status: "completed" as const,
      changed: completed.changed,
      change: withCleanup.change,
      task: null,
    };
  });

type OwnedPullRequestObservation =
  | { readonly ok: true; readonly status: "open" | "closed" | "merged" }
  | {
      readonly ok: false;
      readonly code: "github_pull_request_unavailable" | "owned_pull_request_mismatch";
    };

const observeOwnedPullRequest = (
  dependencies: CancellationDependencies,
  change: ChangeRecord,
): OwnedPullRequestObservation => {
  const publication = change.publication;
  if (publication === null || publication.pullRequest === null)
    return { ok: true, status: "closed" };
  let pullRequest: GitHubPullRequest | undefined;
  try {
    pullRequest = dependencies.github.getPullRequest(
      publication.target,
      publication.pullRequest.number,
    );
  } catch {
    return { ok: false, code: "github_pull_request_unavailable" };
  }
  if (pullRequest === undefined) return { ok: false, code: "github_pull_request_unavailable" };
  if (!matchesOwnedPullRequest(change, pullRequest)) {
    return { ok: false, code: "owned_pull_request_mismatch" };
  }
  if (pullRequest.state === "closed" && pullRequest.merged === true)
    return { ok: true, status: "merged" };
  if (pullRequest.state === "closed" && pullRequest.merged === false)
    return { ok: true, status: "closed" };
  if (pullRequest.state === "open" && pullRequest.merged === false)
    return { ok: true, status: "open" };
  return { ok: false, code: "owned_pull_request_mismatch" };
};

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

const matchesOwnedPullRequest = (change: ChangeRecord, pullRequest: GitHubPullRequest): boolean => {
  const publication = change.publication;
  return (
    publication !== null &&
    publication.pullRequest !== null &&
    pullRequest.repository?.owner === publication.target.owner &&
    pullRequest.repository.repo === publication.target.repo &&
    pullRequest.baseBranch === publication.target.baseBranch &&
    pullRequest.headBranch === publication.headBranch &&
    pullRequest.headSha === publication.expectedHeadSha
  );
};

const cleanupClosedChange = (
  dependencies: CancellationDependencies,
  change: ChangeRecord,
  now: string,
): Effect.Effect<
  { readonly change: ChangeRecord; readonly cleanup: ChangeCleanup },
  RepositoryStorageError
> =>
  Effect.gen(function* () {
    if (change.cleanup.state === "complete") return { change, cleanup: change.cleanup };
    const result = dependencies.cleanup({
      repositoryCommonDirectory: change.repositoryCommonDirectory,
      worktreePath: change.worktreePath,
      branchRef: change.branchRef,
    });
    const cleanup: ChangeCleanup =
      result.state === "complete"
        ? { state: "complete", blockingReason: null }
        : { state: "pending", blockingReason: result.blockingReason };
    const recorded = yield* dependencies.changes.recordCleanup({
      changeId: change.id,
      cleanup,
      now,
    });
    if (!recorded.ok)
      return yield* Effect.die(new Error(`Unable to record cleanup: ${recorded.code}`));
    return { change: recorded.change, cleanup: recorded.change.cleanup };
  });
