import type { TaskState } from "./lifecycle.js";

const submitEligibleStates = [
  "implementing",
  "needs_input",
] as const satisfies readonly TaskState[];

export type SubmitEligibleState = (typeof submitEligibleStates)[number];

const submitEligibleStateSet = new Set<TaskState>(submitEligibleStates);

export type SubmitStateReadiness =
  | {
      readonly ok: true;
      readonly previousTaskState: SubmitEligibleState;
    }
  | {
      readonly ok: false;
      readonly code: "TASK_STATE_NOT_SUBMITTABLE";
      readonly state: TaskState;
    };

export const canSubmitFrom = (state: TaskState): state is SubmitEligibleState =>
  submitEligibleStateSet.has(state);

export const submitStateReadiness = (state: TaskState): SubmitStateReadiness => {
  if (!canSubmitFrom(state)) {
    return { ok: false, code: "TASK_STATE_NOT_SUBMITTABLE", state };
  }

  return { ok: true, previousTaskState: state };
};
