import type { TaskState } from "../task/lifecycle.js";
import { submitStateReadiness, type SubmitEligibleState } from "../task/submitPolicy.js";
import type { PublicTaskId } from "../task/taskId.js";
import type { TaskStore } from "../task/taskStore.js";

export type SubmitReadiness = {
  readonly getTaskSubmitReadiness: (taskId: PublicTaskId) => TaskSubmitReadinessResult;
};

export type TaskSubmitReadinessResult =
  | {
      readonly ok: true;
      readonly taskId: PublicTaskId;
      readonly previousTaskState: SubmitEligibleState;
    }
  | {
      readonly ok: false;
      readonly code: "TASK_NOT_FOUND";
    }
  | {
      readonly ok: false;
      readonly code: "TASK_STATE_NOT_SUBMITTABLE";
      readonly state: TaskState;
    };

export const taskStoreSubmitReadiness = (taskStore: TaskStore): SubmitReadiness => ({
  getTaskSubmitReadiness: (taskId) => {
    const task = taskStore.getTaskById(taskId);

    if (task === undefined) {
      return { ok: false, code: "TASK_NOT_FOUND" };
    }

    const readiness = submitStateReadiness(task.state);

    if (!readiness.ok) {
      return readiness;
    }

    return { ok: true, taskId, previousTaskState: readiness.previousTaskState };
  },
});
