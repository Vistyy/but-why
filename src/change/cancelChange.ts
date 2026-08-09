import { Effect } from "effect";
import type { ExecutionLock } from "../contracts/executionLock.js";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type { RepoTaskIdResolution } from "../task/repoTaskIds.js";
import type { TaskRecord } from "../task/task.js";
import type { PublicTaskId } from "../task/taskId.js";
import type { TaskPersistence } from "../task/taskPersistence.js";
import type { ChangeCleanup, ChangeRecord } from "./change.js";
import type { ChangePersistence } from "./changePersistence.js";
import type { TerminalCleanupOperation } from "./cleanupTerminalChange.js";
import {
  classifyOwnedPullRequest,
  observedMergedChangeEvidence,
  observeOwnedPullRequest,
  ownedPublication,
} from "./ownedPullRequestClassifier.js";
import type {
  GitHubPullRequest,
  GitHubPullRequestGateway,
  PublicationFailureEvidence,
} from "./ownedPullRequestGateway.js";
import type { ChangeValidationPersistence } from "./validation/changeValidationPersistence.js";

export type CancellationUseCases = {
  readonly resolveTaskId: (taskId: PublicTaskId) => RepoTaskIdResolution;
  readonly cancelTask: (input: {
    readonly taskId: PublicTaskId;
    readonly reason: string;
    readonly now: string;
  }) => Effect.Effect<TaskCancellationResult, RepositoryStorageError>;
  readonly cancelChange: (input: {
    readonly changeId: string;
    readonly reason: string;
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
      readonly evidence?: PublicationFailureEvidence;
      readonly recoveryEvidence?: PublicationFailureEvidence;
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
        | "github_pull_request_unavailable"
        | "owned_pull_request_mismatch"
        | "github_close_failed"
        | "submission_in_progress"
        | "active_validation_run";
      readonly changeId: string;
      readonly validationRunId?: string;
      readonly evidence?: PublicationFailureEvidence;
      readonly recoveryEvidence?: PublicationFailureEvidence;
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

    const result = yield* cancelChange(dependencies, {
      changeId: change.id,
      reason: input.reason,
      now: input.now,
    });
    if (!result.ok) {
      return {
        ok: false as const,
        code: result.code,
        taskId: input.taskId,
        ...(result.validationRunId === undefined
          ? {}
          : { validationRunId: result.validationRunId }),
      };
    }
    return {
      ok: true,
      status: result.status,
      changed: result.changed,
      task: result.task ?? task,
      change: result.change,
      cleanup: result.change.cleanup,
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

    if (change.state === "closed") {
      if (change.closeReason !== "cancelled") {
        return { ok: false, code: "change_already_completed" as const, changeId: change.id };
      }
      const withCleanup = yield* cleanupTerminalChange(dependencies, change, input.now);
      const task = yield* loadLinkedTask(dependencies, change);
      return {
        ok: true as const,
        status: "cancelled" as const,
        changed: false,
        change: withCleanup.change,
        task,
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

    const remote = observeOwnedPullRequest(dependencies.github, change);
    switch (remote.kind) {
      case "unavailable":
        return { ok: false, code: "github_pull_request_unavailable", changeId: change.id };
      case "mismatch":
        return { ok: false, code: "owned_pull_request_mismatch", changeId: change.id };
      case "exact_merged":
        return yield* completeMerged(dependencies, change, input.now, remote.pullRequest);
      case "exact_open": {
        const closed = closeOwnedPullRequest(dependencies, change);
        if (!closed.ok) return { ...closed, changeId: change.id };
        if (closed.status === "merged") {
          return yield* completeMerged(dependencies, change, input.now, closed.pullRequest);
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
    if (!cancelled.ok) return { ...cancelled, changeId: change.id };
    const withCleanup = yield* cleanupTerminalChange(dependencies, cancelled.change, input.now);
    const task = yield* loadLinkedTask(dependencies, change);
    return {
      ok: true as const,
      status: "cancelled" as const,
      changed: cancelled.changed,
      change: withCleanup.change,
      task,
    };
  });

const loadLinkedTask = (
  dependencies: CancellationDependencies,
  change: ChangeRecord,
): Effect.Effect<TaskRecord | null, RepositoryStorageError> =>
  change.taskId === null
    ? Effect.succeed(null)
    : Effect.map(dependencies.tasks.getTaskById(change.taskId), (task) => task ?? null);

const completeMerged = (
  dependencies: CancellationDependencies,
  change: ChangeRecord,
  now: string,
  mergedPullRequest: GitHubPullRequest,
): Effect.Effect<ChangeCancellationResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const observed = observedMergedChangeEvidence(change, mergedPullRequest);
    if (observed === undefined)
      return {
        ok: false as const,
        code: "owned_pull_request_mismatch" as const,
        changeId: change.id,
      };
    const completed = yield* dependencies.changes.completeMergedChange({
      changeId: change.id,
      now,
      observed,
    });
    if (!completed.ok) {
      return completed.code === "publication_mismatch"
        ? {
            ok: false as const,
            code: "owned_pull_request_mismatch" as const,
            changeId: change.id,
          }
        : { ok: false as const, code: "change_already_completed" as const, changeId: change.id };
    }
    const withCleanup = yield* cleanupTerminalChange(dependencies, completed.change, now);
    const task = yield* loadLinkedTask(dependencies, change);
    return {
      ok: true as const,
      status: "completed" as const,
      changed: completed.changed,
      change: withCleanup.change,
      task,
    };
  });

const closeOwnedPullRequest = (
  dependencies: CancellationDependencies,
  change: ChangeRecord,
):
  | { readonly ok: true; readonly status: "closed"; readonly pullRequest: null }
  | { readonly ok: true; readonly status: "merged"; readonly pullRequest: GitHubPullRequest }
  | {
      readonly ok: false;
      readonly code: "github_close_failed";
      readonly evidence?: PublicationFailureEvidence;
      readonly recoveryEvidence?: PublicationFailureEvidence;
    } => {
  const publication = ownedPublication(change);
  if (publication === undefined) return { ok: true, status: "closed", pullRequest: null };
  let evidence: PublicationFailureEvidence | undefined;
  if (dependencies.github.closePullRequest !== undefined) {
    try {
      const result = dependencies.github.closePullRequest({
        target: publication.target,
        number: publication.pullRequest.number,
      });
      if (result.ok) {
        const classified = classifyOwnedPullRequest(publication, result.pullRequest);
        if (classified.kind === "exact_closed_unmerged")
          return { ok: true, status: "closed", pullRequest: null };
        if (classified.kind === "exact_merged")
          return { ok: true, status: "merged", pullRequest: classified.pullRequest };
        evidence = conflictingCloseEvidence;
      } else {
        evidence = result.evidence;
      }
    } catch {
      evidence = unavailableCloseEvidence;
    }
  } else {
    evidence = unavailableCloseEvidence;
  }

  const recovered = observeOwnedPullRequest(dependencies.github, change);
  if (recovered.kind === "exact_closed_unmerged")
    return { ok: true, status: "closed", pullRequest: null };
  if (recovered.kind === "exact_merged")
    return { ok: true, status: "merged", pullRequest: recovered.pullRequest };
  return {
    ok: false,
    code: "github_close_failed",
    ...(evidence === undefined ? {} : { evidence }),
    recoveryEvidence:
      recovered.kind === "unavailable" ? unavailableRecoveryEvidence : conflictingRecoveryEvidence,
  };
};

const conflictingCloseEvidence = {
  operation: "pull_request_close",
  classification: "conflict",
  reason: "postcondition_mismatch",
} as const;

const unavailableCloseEvidence = {
  operation: "pull_request_close",
  classification: "unavailable",
  reason: "unavailable",
} as const;

const unavailableRecoveryEvidence = {
  operation: "remote_lookup",
  classification: "unavailable",
  reason: "unavailable",
} as const;

const conflictingRecoveryEvidence = {
  operation: "remote_lookup",
  classification: "conflict",
  reason: "postcondition_mismatch",
} as const;

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
