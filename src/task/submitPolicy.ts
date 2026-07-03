import type { TaskState } from "./lifecycle.js";

const submitEligibleStates = [
  "implementing",
  "needs_input",
] as const satisfies readonly TaskState[];

export type SubmitEligibleState = (typeof submitEligibleStates)[number];

const submitEligibleStateSet = new Set<TaskState>(submitEligibleStates);

export const canSubmitFrom = (state: TaskState): state is SubmitEligibleState =>
  submitEligibleStateSet.has(state);
