import type { RepoLocalContext } from "../init/repoContext.js";
import { submitStateReadiness } from "../task/submitPolicy.js";
import type { TaskContext } from "../task/task.js";
import type { PublicTaskId } from "../task/taskId.js";
import type { TaskStore } from "../task/taskStore.js";
import { resolveRepoTaskId } from "../task/repoTaskIds.js";
import type { StartValidationRunInput, ValidationRuns } from "../validation/validationRuns.js";
import { TaskContextSnapshotFailed } from "../validation/validationToolingFailures.js";
import {
  taskContextSnapshotV1,
  type TaskContextSnapshotV1,
} from "../validationRun/taskContextSnapshot.js";
import type {
  TaskAuthority,
  TaskAuthorityStartValidationResult,
  TaskSubmitReadinessResult,
} from "./taskAuthority.js";

export const localTaskAuthority = (input: {
  readonly context: RepoLocalContext;
  readonly taskStore: TaskStore;
  readonly validationRuns: ValidationRuns;
}): TaskAuthority => ({
  taskPrefix: input.context.taskPrefix,
  resolveTaskId: (taskId) => resolveRepoTaskId(input.context, taskId),
  getTaskSubmitReadiness: (taskId) => getTaskSubmitReadiness(input.taskStore, taskId),
  recoverPendingTaskContextSnapshot: (recoveryInput) =>
    input.validationRuns.recoverPendingTaskContextSnapshot(recoveryInput),
  startValidation: (validationInput) =>
    startValidation(input.taskStore, input.validationRuns, validationInput),
  recordValidationToolingFailure: (failureInput) =>
    input.validationRuns.recordToolingFailure(failureInput),
  recordPhaseStatus: (phaseStatusInput) => input.validationRuns.recordPhaseStatus(phaseStatusInput),
  recordPrepareRound: (prepareRoundInput) =>
    input.validationRuns.recordPrepareRound(prepareRoundInput),
  recordCheckRound: (checkRoundInput) => input.validationRuns.recordCheckRound(checkRoundInput),
});

const startValidation = (
  taskStore: TaskStore,
  validationRuns: ValidationRuns,
  input: StartValidationRunInput,
): TaskAuthorityStartValidationResult => {
  const started = validationRuns.start(input);

  if (!started.ok) {
    return started;
  }

  let context: TaskContext | undefined;

  try {
    context = taskStore.getTaskContextById(input.taskId);
  } catch (error) {
    return failValidationStart(validationRuns, started, input.now, "read_task_context", error);
  }

  if (context === undefined) {
    return failValidationStart(
      validationRuns,
      started,
      input.now,
      "read_task_context",
      new Error(`Task Context was not found: ${input.taskId}`),
    );
  }

  let snapshot: TaskContextSnapshotV1;

  try {
    snapshot = taskContextSnapshotV1(context);
  } catch (error) {
    return failValidationStart(
      validationRuns,
      started,
      input.now,
      "build_task_context_snapshot",
      error,
    );
  }

  try {
    const saved = validationRuns.saveTaskContextSnapshot({
      validationRunId: started.validationRunId,
      snapshot,
      now: input.now,
    });

    if (saved.ok) {
      return started;
    }

    return failValidationStart(
      validationRuns,
      started,
      input.now,
      "save_task_context_snapshot",
      new Error(`Task Context Snapshot could not be saved: ${saved.code}`),
    );
  } catch (error) {
    return failValidationStart(
      validationRuns,
      started,
      input.now,
      "save_task_context_snapshot",
      error,
    );
  }
};

const failValidationStart = (
  validationRuns: ValidationRuns,
  started: Extract<ReturnType<ValidationRuns["start"]>, { readonly ok: true }>,
  now: string,
  operationName: TaskContextSnapshotFailed["operationName"],
  error: unknown,
): TaskAuthorityStartValidationResult => {
  const failure = new TaskContextSnapshotFailed({
    operationName,
    message: error instanceof Error ? error.message : "Task Context Snapshot creation failed.",
  });
  validationRuns.recordToolingFailure({
    validationRunId: started.validationRunId,
    toolingFailure: failure,
    taskRecoveryState: started.previousTaskState,
    now,
  });

  return {
    ok: false,
    code: "TASK_CONTEXT_SNAPSHOT_FAILED",
    operationName: failure.operationName,
    message: failure.message,
  };
};

const getTaskSubmitReadiness = (
  taskStore: TaskStore,
  taskId: PublicTaskId,
): TaskSubmitReadinessResult => {
  const task = taskStore.getTaskById(taskId);

  if (task === undefined) {
    return { ok: false, code: "TASK_NOT_FOUND" };
  }

  const readiness = submitStateReadiness(task.state);

  if (!readiness.ok) {
    return readiness;
  }

  return { ok: true, taskId, previousTaskState: readiness.previousTaskState };
};
