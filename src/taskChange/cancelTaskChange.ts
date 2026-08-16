import { Effect } from "effect";
import type { ChangeCleanup } from "../change/change.js";
import type { TerminalCleanupOperation } from "../change/cleanupTerminalChange.js";
import {
  classifyOwnedPullRequest,
  observedMergedChangeEvidence,
  observeOwnedPullRequest,
  ownedPublication,
} from "../change/ownedPullRequestClassifier.js";
import type {
  GitHubPullRequest,
  GitHubPullRequestCloser,
  PublicationFailureEvidence,
} from "../change/ownedPullRequestGateway.js";
import type { ActiveValidationRunPort } from "../change/validation/changeValidationPorts.js";
import type { ExecutionLock } from "../contracts/executionLock.js";
import {
  RepositoryPersistedDataInvalid,
  type RepositoryStorageError,
} from "../contracts/repositoryStorageError.js";
import type { RepoTaskIdResolution } from "../task/repoTaskIds.js";
import type { TaskRecord } from "../task/task.js";
import { type PublicTaskId, storedPublicTaskId } from "../task/taskId.js";
import type { TaskPersistence } from "../task/taskPersistence.js";
import type {
  TaskChangeCancellationChange,
  TaskChangeCancellationPort,
} from "./taskChangePorts.js";

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
  readonly changes: TaskChangeCancellationPort;
  readonly github: GitHubPullRequestCloser;
  readonly validation: ActiveValidationRunPort;
  readonly executionLock: ExecutionLock;
  readonly cleanupTerminal: TerminalCleanupOperation;
};

export type TaskCancellationResult =
  | {
      readonly ok: true;
      readonly status: "cancelled" | "completed";
      readonly changed: boolean;
      readonly task: TaskRecord;
      readonly change: TaskChangeCancellationChange | null;
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
      readonly change: TaskChangeCancellationChange;
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
    const task = yield* dependencies.tasks.getTaskById(input.taskId);
    if (task === undefined) return { ok: false, code: "task_not_found", taskId: input.taskId };
    if (task.state === "done")
      return { ok: false, code: "task_already_done", taskId: input.taskId };
    const change = yield* dependencies.changes.getChangeByTaskId(input.taskId);
    if (change === undefined) {
      return yield* cancelTask(dependencies, input, { task, change });
    }
    return yield* dependencies.executionLock
      .withLock({
        owner: "change_submission",
        key: change.id,
        effect: cancelTask(dependencies, input, { task, change }),
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
  selected?: {
    readonly task: TaskRecord;
    readonly change: TaskChangeCancellationChange | undefined;
  },
): Effect.Effect<TaskCancellationResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const task = selected?.task ?? (yield* dependencies.tasks.getTaskById(input.taskId));
    if (task === undefined) return { ok: false, code: "task_not_found", taskId: input.taskId };
    if (task.state === "done")
      return { ok: false, code: "task_already_done", taskId: input.taskId };

    const change =
      selected === undefined
        ? yield* dependencies.changes.getChangeByTaskId(input.taskId)
        : selected.change;
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
        : {
            ok: false,
            code: cancelled.code,
            taskId: input.taskId,
          };
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
        ...(result.evidence === undefined ? {} : { evidence: result.evidence }),
        ...(result.recoveryEvidence === undefined
          ? {}
          : { recoveryEvidence: result.recoveryEvidence }),
      };
    }
    if (result.task === null) return { ok: false, code: "task_not_found", taskId: input.taskId };
    return {
      ok: true,
      status: result.status,
      changed: result.changed,
      task: result.task,
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

    const active = yield* dependencies.validation.getActiveForChange(change.id);
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
    return {
      ok: true as const,
      status: "cancelled" as const,
      changed: cancelled.changed,
      change: withCleanup.change,
      task: cancelled.task,
    };
  });

const loadLinkedTask = (
  dependencies: CancellationDependencies,
  change: TaskChangeCancellationChange,
): Effect.Effect<TaskRecord | null, RepositoryStorageError> =>
  change.taskId === null
    ? Effect.succeed(null)
    : Effect.flatMap(dependencies.tasks.getTaskById(storedPublicTaskId(change.taskId)), (task) =>
        task === undefined
          ? Effect.fail(
              new RepositoryPersistedDataInvalid({
                operationName: "read linked Task for Change cancellation",
                cause: new Error("Linked Task was not found"),
              }),
            )
          : Effect.succeed(task),
      );

const completeMerged = (
  dependencies: CancellationDependencies,
  change: TaskChangeCancellationChange,
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
    return {
      ok: true as const,
      status: "completed" as const,
      changed: completed.changed,
      change: withCleanup.change,
      task: completed.task,
    };
  });

const closeOwnedPullRequest = (
  dependencies: CancellationDependencies,
  change: TaskChangeCancellationChange,
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
  change: TaskChangeCancellationChange,
  now: string,
): Effect.Effect<
  { readonly change: TaskChangeCancellationChange; readonly cleanup: ChangeCleanup },
  RepositoryStorageError
> =>
  Effect.map(dependencies.cleanupTerminal(change, now), (result) =>
    result.ok
      ? { change: { ...change, cleanup: result.cleanup }, cleanup: result.cleanup }
      : { change, cleanup: change.cleanup },
  );
