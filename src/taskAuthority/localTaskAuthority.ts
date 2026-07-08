import type { RepoLocalContext } from "../init/repoContext.js";
import { submitStateReadiness } from "../task/submitPolicy.js";
import type { PublicTaskId } from "../task/taskId.js";
import type { TaskStore } from "../task/taskStore.js";
import { resolveRepoTaskId } from "../task/repoTaskIds.js";
import type { ValidationRuns } from "../validation/validationRuns.js";
import type { TaskAuthority, TaskSubmitReadinessResult } from "./taskAuthority.js";

export const localTaskAuthority = (input: {
  readonly context: RepoLocalContext;
  readonly taskStore: TaskStore;
  readonly validationRuns: ValidationRuns;
}): TaskAuthority => ({
  taskPrefix: input.context.taskPrefix,
  resolveTaskId: (taskId) => resolveRepoTaskId(input.context, taskId),
  getTaskSubmitReadiness: (taskId) => getTaskSubmitReadiness(input.taskStore, taskId),
  startValidation: (validationInput) => input.validationRuns.start(validationInput),
  recordValidationToolingFailure: (failureInput) =>
    input.validationRuns.recordToolingFailure(failureInput),
  recordCheckRound: (checkRoundInput) => input.validationRuns.recordCheckRound(checkRoundInput),
});

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
